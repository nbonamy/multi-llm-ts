import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMetadata, ModelOpenAI } from '../types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmRole, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'

import OpenAI, { ClientOptions } from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions'
import { minimatch } from 'minimatch'

const defaultBaseUrl = 'https://api.openai.com/v1'

//
// https://platform.openai.com/docs/api-reference/introduction
// 

export type OpenAIStreamingContext = LlmStreamingContextTools & {
  done?: boolean
}

export default class extends LlmEngine {

  client: OpenAI

  constructor(config: EngineCreateOpts, opts?: ClientOptions) {
    super(config)
    this.client = new OpenAI({
      apiKey: opts?.apiKey || config.apiKey,
      baseURL: opts?.baseURL || config.baseURL || defaultBaseUrl,
      dangerouslyAllowBrowser: true
    })
  }

  getId(): string {
    return 'openai'
  }

  // https://openai.com/api/pricing/

  getModelCapabilities(model: ModelMetadata): ModelCapabilities {
    
    const visionGlobs = [
      '*vision*',
      'gpt-4-turbo*',
      'gpt-4-0125*',
      'gpt-4-1106-vision-preview',
      'gpt-4o*',
      'chatgpt-4o',
      'gpt-4.1*',
      'gpt-4.5*',
      'o1*',
      'o3*',
      'o4*',
    ]

    const excludeVisionGlobs = [
      'gpt-4o-mini-audio*',
      'o1-mini*',
      'o3-mini*'
    ]

    const modelId = (model as ModelOpenAI).id
    
    return {
      tools: !modelId.startsWith('chatgpt-') && !modelId.startsWith('o1-mini'),
      vision: visionGlobs.some((m) => minimatch(modelId, m)) && !excludeVisionGlobs.some((m) => minimatch(modelId, m)),
      reasoning: modelId.startsWith('o')
    }
  }

  modelAcceptsSystemRole(model: string): boolean {
    return !model.startsWith('o1')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsMaxTokens(model: ChatModel): boolean {
    return true
  }

  modelSupportsTemperature(model: ChatModel): boolean {
    return !model.capabilities.reasoning
  }

  modelSupportsTopP(model: ChatModel): boolean {
    return !model.capabilities.reasoning
  }

  modelSupportsTopK(model: ChatModel): boolean {
    return !model.capabilities.reasoning
  }

  modelSupportsReasoningEffort(model: ChatModel): boolean {
    return model.capabilities.reasoning
  }

  get systemRole(): LlmRole {
    return 'system'//'developer'
  }

  async getModels(): Promise<ModelMetadata[]> {

    // // need an api key
    // if (!this.client.apiKey) {
    //   return []
    // }

    // do it
    try {
    
      const response = await this.client.models.list()
      let models = response.data
      if (models === null || models.length === 0) {
        // @ts-expect-error togetherai hack
        if (response.body && Array.isArray(response.body)) {
          // @ts-expect-error togetherai hack
          models = response.body as OpenAI.Model[]
        }
      }

      // done
      return models
    
    } catch (error) {
      console.error('Error listing models:', error);
      return []
    }
  }

  protected setBaseURL() {
    if (this.client) {
      this.client.baseURL = this.config.baseURL || defaultBaseUrl
    }
  }

  buildPayload(model: ChatModel, thread: Message[] | string, opts?: LlmCompletionOpts): LLmCompletionPayload[] {
    let payload = super.buildPayload(model, thread, opts)
    if (!this.modelAcceptsSystemRole(model.id)) {
      payload = payload.filter((msg: LLmCompletionPayload) => msg.role !== 'system')
    } else if (this.systemRole !== 'system') {
      payload = payload.map((msg: LLmCompletionPayload) => {
        if (msg.role === 'system') {
          msg.role = this.systemRole
        }
        return msg
      })
    }
    return payload
  }

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // set baseURL on client
    this.setBaseURL()

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[${this.getName()}] prompting model ${model.id}`)
    const response = await this.client.chat.completions.create({
      model: model.id,
      messages: thread,
      ...this.getCompletionOpts(model, opts),
      ...await this.getToolsOpts(model, opts),
    });

    // get choice
    const choice = response.choices?.[0]

    // tool call
    if (choice?.finish_reason === 'tool_calls') {

      // add tool call message
      thread.push(choice.message)

      const toolCalls = choice.message.tool_calls!
      for (const toolCall of toolCalls) {

        // log
        logger.log(`[openai] tool call ${toolCall.function.name} with ${toolCall.function.arguments}`)

        // this can error
        let args = null
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch (err) {
          throw new Error(`[openai] tool call ${toolCall.function.name} with invalid JSON args: "${toolCall.function.arguments}"`, { cause: err })
        }
        
        // now execute
        const content = await this.callTool(toolCall.function.name, args)
        logger.log(`[openai] tool call ${toolCall.function.name} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool response message
        thread.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify(content)
        })

        // save tool call info
        toolCallInfo.push({
          name: toolCall.function.name,
          params: args,
          result: content
        })

      }

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // prepend tool call info
      completion.toolCalls = [
        ...toolCallInfo,
        ...completion.toolCalls ?? [],
      ]

      // cumulate usage
      if (opts?.usage && response.usage && completion.usage) {
        completion.usage.prompt_tokens += response.usage.prompt_tokens
        if (response.usage.prompt_tokens_details?.cached_tokens) {
          completion.usage.prompt_tokens_details!.cached_tokens! += response.usage.prompt_tokens_details?.cached_tokens
        }
        if (response.usage.prompt_tokens_details?.audio_tokens) {
          completion.usage.prompt_tokens_details!.audio_tokens! += response.usage.prompt_tokens_details?.audio_tokens
        }
        if (response.usage.completion_tokens_details?.reasoning_tokens) {
          completion.usage.completion_tokens_details!.reasoning_tokens! += response.usage.completion_tokens_details?.reasoning_tokens
        }
        if (response.usage.completion_tokens_details?.audio_tokens) {
          completion.usage.completion_tokens_details!.audio_tokens! += response.usage.completion_tokens_details?.audio_tokens
        }
      }

      // done
      return completion
    
    }

    // total tokens is not part of our response
    if (response.usage?.total_tokens) {
      // @ts-expect-error "must be optional"???
      delete response.usage.total_tokens
    }

    // done
    return {
      type: 'text',
      content: choice.message.content || '',
      toolCalls: toolCallInfo,
      ...(opts?.usage && response.usage ? { usage: response.usage } : {}),
    }

  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // set baseURL on client
    this.setBaseURL()

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)
    const context: OpenAIStreamingContext = {
      model: model,
      thread: this.buildPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      done: false,
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context,
    }

  }

  async doStream(context: OpenAIStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []

    // call
    logger.log(`[${this.getName()}] prompting model ${context.model.id}`)
    const stream = this.client.chat.completions.create({
      model: context.model.id,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolsOpts(context.model, context.opts),
      stream_options: { include_usage: context.opts.usage || false },
      stream: true,
    })

    // done
    return stream

  }

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<ChatCompletionCreateParamsBase, 'model'|'messages'|'stream'> {
    return {
      ...(this.modelSupportsMaxTokens(model) && opts?.maxTokens ? { max_completion_tokens: opts?.maxTokens } : {} ),
      ...(this.modelSupportsTemperature(model) && opts?.temperature ? { temperature: opts?.temperature } : {} ),
      ...(this.modelSupportsTopK(model) && opts?.top_k ? { logprobs: true, top_logprobs: opts?.top_k } : {} ),
      ...(this.modelSupportsTopP(model) && opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(this.modelSupportsReasoningEffort(model) && opts?.reasoningEffort ? { reasoning_effort: opts?.reasoningEffort } : {}),
      ...(opts?.customOpts ? opts.customOpts : {}),
    }
  }

  async getToolsOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<ChatCompletionCreateParamsBase, 'model'|'messages'|'stream'>> {

    // check if enabled
    if (opts?.tools === false || !model.capabilities?.tools) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    return tools.length ? {
      tools: tools,
      tool_choice: 'auto',
    } : {}

  }

  async stop(stream: LlmStream) {
    stream?.controller?.abort()
  }

  async *nativeChunkToLlmChunk(chunk: ChatCompletionChunk, context: OpenAIStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // debug
    //console.dir(chunk, { depth: null })

    // tool calls
    const tool_call = chunk.choices[0]?.delta?.tool_calls?.[0]
    if (tool_call?.function) {

      // arguments or new tool?
      if (tool_call.id !== null && tool_call.id !== undefined && tool_call.id !== '') {

        // try to find if we already have this tool call
        const existingToolCall = context.toolCalls.find(tc => tc.id === tool_call.id)
        if (existingToolCall) {

          // append arguments to existing tool call
          existingToolCall.args += tool_call.function.arguments

        } else {

          // debug
          //logger.log(`[${this.getName()}] tool call start:`, chunk)

          // record the tool call
          const toolCall: LlmToolCall = {
            id: tool_call.id,
            message: chunk.choices[0].delta.tool_calls!.map((tc: any) => {
              delete tc.index
              return tc
            }),
            function: tool_call.function.name || '',
            args: tool_call.function.arguments || '',
          }
          context.toolCalls.push(toolCall)

          // first notify
          yield {
            type: 'tool',
            name: toolCall.function,
            status: this.getToolPreparationDescription(toolCall.function),
            done: false
          }

        }

        // done
        //return
      
      } else {

        // append arguments
        const toolCall = context.toolCalls[context.toolCalls.length-1]
        toolCall.args += tool_call.function.arguments
        toolCall.message[toolCall.message.length-1].function.arguments = toolCall.args

        // done
        //return

      }

    }

    // now tool calling
    if (['tool_calls', 'function_call', 'stop'].includes(chunk.choices[0]?.finish_reason|| '') && context.toolCalls?.length) {

      // iterate on tools
      for (const toolCall of context.toolCalls) {

        // log
        logger.log(`[openai] tool call ${toolCall.function} with ${toolCall.args}`)

        // this can error
        let args = null
        try {
          args = JSON.parse(toolCall.args)
        } catch (err) {
          throw new Error(`[openai] tool call ${toolCall.function} with invalid JSON args: "${toolCall.args}"`, { cause: err })
        }
        
        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function, args),
          done: false
        }

        // now execute
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[openai] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool call message
        context.thread.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCall.message
        })

        // add tool response message
        context.thread.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function,
          content: JSON.stringify(content)
        })

        // clear
        yield {
          type: 'tool',
          name: toolCall.function,
          done: true,
          call: {
            params: args,
            result: content
          },
        }

      }

      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(context),
      }

      // done
      return

    }

    // done?
    const done = ['stop', 'length', 'content_filter', 'eos'].includes(chunk.choices[0]?.finish_reason || '')
    if (done) {
      context.done = true
    }

    // reasoning chunk
    // @ts-expect-error not in official api but used by deepseek
    if (chunk.choices?.length && chunk.choices[0]?.delta?.reasoning_content) {
      yield {
        type: 'reasoning',
        // @ts-expect-error not in official api but used by deepseek
        text: chunk.choices[0]?.delta?.reasoning_content || '',
        done: done,
      }
    }

    // text chunk
    if (chunk.choices?.length && (chunk.choices[0]?.delta?.content || done)) {
      yield {
        type: 'content',
        text: chunk.choices[0]?.delta?.content || '',
        done: done
      }
    }

    // usage
    if (context.opts?.usage && context.done && chunk.usage) {
      yield {
        type: 'usage',
        usage: chunk.usage
      }
    }

  }

  defaultRequiresFlatTextPayload(msg: Message): boolean {
    return super.requiresFlatTextPayload(msg)
  }
  
  requiresFlatTextPayload(msg: Message): boolean {
    return this.defaultRequiresFlatTextPayload(msg) || (this.client.baseURL?.length > 0 && this.client.baseURL !== defaultBaseUrl)
  }

}
