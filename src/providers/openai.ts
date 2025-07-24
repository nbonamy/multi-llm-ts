import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMetadata, ModelOpenAI } from '../types/index'

import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmRole, LlmStream, LlmTool, LlmToolCall, LlmToolCallInfo, LlmToolChoice, LlmUsage } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import { zeroUsage } from '../usage'
import logger from '../logger'

import OpenAI, { ClientOptions } from 'openai'
import { CompletionUsage } from 'openai/resources'
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions'
import { Response, ResponseCreateParams, ResponseFunctionToolCall, ResponseOutputMessage, ResponseStreamEvent, ResponseUsage, Tool, ToolChoiceFunction, ToolChoiceOptions } from 'openai/resources/responses/responses'
import { zodResponseFormat } from 'openai/helpers/zod'
import { minimatch } from 'minimatch'

type OpenAIToolOpts = Omit<ChatCompletionCreateParamsBase, 'model' | 'messages' | 'stream'>

const defaultBaseUrl = 'https://api.openai.com/v1'

//
// https://platform.openai.com/docs/api-reference/introduction
// 

export type OpenAIStreamingContext = LlmStreamingContextTools & {
  responsesApi: boolean
  thinking: boolean
  done?: boolean
}

type OpenAIStreamingResponse = {
  stream: LlmStream
  context: OpenAIStreamingContext
}

export default class extends LlmEngine {

  client: OpenAI

  constructor(config: EngineCreateOpts, opts?: ClientOptions) {
    super(config)
    this.client = new OpenAI({
      apiKey: opts?.apiKey || config.apiKey,
      baseURL: opts?.baseURL || config.baseURL || defaultBaseUrl,
      timeout: opts?.timeout || config.timeout || undefined,
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
      reasoning: modelId.startsWith('o'),
      caching: false,
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

  modelRequiresResponsesApi(model: ChatModel): boolean {
    return ['o3-pro*', 'codex*'].some((m) => minimatch(model.id, m))
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsStructuredOutput(model: ChatModel): boolean {
    return true
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  doesNotSendToolCallFinishReason(model: ChatModel): boolean {
    return false
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

  protected shouldUseResponsesApi(model: ChatModel, opts?: LlmCompletionOpts): boolean {
    return this.modelRequiresResponsesApi(model) || (opts?.useOpenAIResponsesApi ?? false) || (this.config.useOpenAIResponsesApi ?? false)
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

    // process with responses api?
    if (this.shouldUseResponsesApi(model, opts)) {
      return this.responsesChat(model, thread as any, opts)
    }

    // Fallback to Chat Completions

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
    if (choice.message.tool_calls && (choice?.finish_reason === 'tool_calls' || this.doesNotSendToolCallFinishReason(model))) {

      // add tool call message
      thread.push(choice.message)

      for (const tool_call of choice.message.tool_calls) {

        // log
        logger.log(`[openai] tool call ${tool_call.function.name} with ${tool_call.function.arguments}`)

        // this can error
        let args = null
        try {
          args = JSON.parse(tool_call.function.arguments)
        } catch (err) {
          throw new Error(`[openai] tool call ${tool_call.function.name} with invalid JSON args: "${tool_call.function.arguments}"`, { cause: err })
        }

        // now execute
        const content = await this.callTool({ model: model.id }, tool_call.function.name, args)
        logger.log(`[openai] tool call ${tool_call.function.name} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool response message
        thread.push({
          role: 'tool',
          tool_call_id: tool_call.id,
          name: tool_call.function.name,
          content: JSON.stringify(content)
        })

        // save tool call info
        toolCallInfo.push({
          name: tool_call.function.name,
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
        this.accumulateUsage(completion.usage, response.usage)
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

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<OpenAIStreamingResponse> {

    // process with responses api?
    if (this.shouldUseResponsesApi(model, opts)) {
      return this.responsesStream(model, thread, opts)
    }

    // set baseURL on client
    this.setBaseURL()

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)
    const context: OpenAIStreamingContext = {
      model: model,
      responsesApi: false,
      thread: this.buildPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      usage: zeroUsage(),
      thinking: false,
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

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<ChatCompletionCreateParamsBase, 'model' | 'messages' | 'stream'> {
    return {
      ...(this.modelSupportsMaxTokens(model) && opts?.maxTokens ? { max_completion_tokens: opts?.maxTokens } : {}),
      ...(this.modelSupportsTemperature(model) && opts?.temperature ? { temperature: opts?.temperature } : {}),
      ...(this.modelSupportsTopK(model) && opts?.top_k ? { logprobs: true, top_logprobs: opts?.top_k } : {}),
      ...(this.modelSupportsTopP(model) && opts?.top_p ? { top_p: opts?.top_p } : {}),
      ...(this.modelSupportsReasoningEffort(model) && opts?.reasoningEffort ? { reasoning_effort: opts?.reasoningEffort } : {}),
      ...(this.modelSupportsStructuredOutput(model) && opts?.structuredOutput ? { response_format: zodResponseFormat(opts.structuredOutput.structure, opts.structuredOutput.name) } : {}),
      ...(opts?.customOpts ? opts.customOpts : {}),
    }
  }

  async getToolsOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<OpenAIToolOpts> {

    // check if enabled
    if (opts?.tools === false || !model.capabilities?.tools) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    if (!tools.length) return {}

    // default chat-completions style
    return {
      tools: tools,
      tool_choice: opts?.toolChoice?.type === 'tool' ? {
        type: 'function',
        function: { name: opts.toolChoice.name }
      } : opts?.toolChoice?.type ?? 'auto',
    }

  }

  async stop(stream: LlmStream) {
    stream?.controller?.abort()
  }

  async *nativeChunkToLlmChunk(chunk: any, context: OpenAIStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // response api events have already been translated to LLmChunk's
    if (context.responsesApi) {
      yield chunk as LlmChunk
      return
    }

    // Guard malformed chunks without choices
    if (!chunk?.choices || !Array.isArray(chunk.choices)) {
      return
    }

    // debug
    //console.dir(chunk, { depth: null })

    // cumulate usage
    if (chunk.usage && context.opts?.usage) {
      this.accumulateUsage(context.usage, chunk.usage)
    }

    // tool calls
    for (const tool_call of chunk.choices[0]?.delta?.tool_calls || []) {

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
              id: toolCall.id,
              name: toolCall.function,
              status: this.getToolPreparationDescription(toolCall.function),
              done: false
            }

          }

          // done
          //return

        } else {

          // append arguments
          const toolCall = context.toolCalls[context.toolCalls.length - 1]
          toolCall.args += tool_call.function.arguments
          toolCall.message[toolCall.message.length - 1].function.arguments = toolCall.args

          // done
          //return

        }

      }
    }

    // some providers (xai) do not send a finish_reason
    if (context.toolCalls.length && this.doesNotSendToolCallFinishReason(context.model)) {
      chunk.choices[0].finish_reason = chunk.choices[0].finish_reason || 'tool_calls'
    }

    // now tool calling
    if (['tool_calls', 'function_call', 'stop'].includes(chunk.choices[0]?.finish_reason || '') && context.toolCalls?.length) {

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
          id: toolCall.id,
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function, args),
          call: {
            params: args,
            result: undefined
          },
          done: false
        }

        // now execute
        const content = await this.callTool({ model: context.model.id }, toolCall.function, args)
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
          id: toolCall.id,
          name: toolCall.function,
          status: this.getToolCompletedDescription(toolCall.function, args, content),
          done: true,
          call: {
            params: args,
            result: content
          },
        }

      }

      // clear force tool call to avoid infinite loop
      if (context.opts.toolChoice?.type === 'tool') {
        delete context.opts.toolChoice
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
    const done = ['stop', 'length', 'content_filter', 'eos'].includes(chunk.choices?.[0]?.finish_reason || '')
    if (done) {
      context.done = true
    }

    // reasoning chunk

    if (chunk.choices?.length && chunk.choices?.[0]?.delta?.reasoning_content) {
      yield {
        type: 'reasoning',
        text: chunk.choices?.[0]?.delta?.reasoning_content || '',
        done: done,
      }
    }

    // text chunk
    if (chunk.choices?.length && (chunk.choices?.[0]?.delta?.content || done)) {
      yield {
        type: context.thinking ? 'reasoning' : 'content',
        text: chunk.choices?.[0]?.delta?.content || '',
        done: done
      }
    }

    // usage
    if (context.opts?.usage && context.done && context.usage) {
      yield { type: 'usage', usage: context.usage }
    }

  }

  defaultRequiresFlatTextPayload(msg: Message): boolean {
    return super.requiresFlatTextPayload(msg)
  }

  requiresFlatTextPayload(msg: Message): boolean {
    return this.defaultRequiresFlatTextPayload(msg) || (this.client.baseURL?.length > 0 && this.client.baseURL !== defaultBaseUrl)
  }

  accumulateUsage(cumulate: LlmUsage, usage: CompletionUsage) {

    cumulate.prompt_tokens += usage.prompt_tokens ?? 0
    cumulate.completion_tokens += usage.completion_tokens ?? 0
    
    if (usage.prompt_tokens_details?.cached_tokens) {
      cumulate.prompt_tokens_details!.cached_tokens! += usage.prompt_tokens_details?.cached_tokens
    }
    if (usage.prompt_tokens_details?.audio_tokens) {
      cumulate.prompt_tokens_details!.audio_tokens! += usage.prompt_tokens_details?.audio_tokens
    }
    
    if (usage.completion_tokens_details?.reasoning_tokens) {
      cumulate.completion_tokens_details!.reasoning_tokens! += usage.completion_tokens_details?.reasoning_tokens
    }
    if (usage.completion_tokens_details?.audio_tokens) {
      cumulate.completion_tokens_details!.audio_tokens! += usage.completion_tokens_details?.audio_tokens
    }    
  }

  //
  // Response API stuff
  //

  // ---------------------------------------------------------------------------
  // Responses API – via official SDK with automatic tool execution
  async responsesChat(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // log
    logger.log(`[${this.getName()}] prompting model ${model.id}`)

    // Build request for Responses API
    const request = await this.buildResponsesRequest(model, thread, opts, false)

    // init stuff
    let text = ''
    const toolCallInfo: LlmToolCallInfo[] = []
    const usage: LlmUsage = zeroUsage()

    // debug
    logger.debug('[responses] REQUEST', JSON.stringify(request, null, 2))

    // call
    let response: Response = await this.client.responses.create(request) as Response

    // we can loop several times calling tools
    while (true) {

      // update responseId tracking
      logger.debug('[responses] RESPONSE', response)

      // cumulate usage
      if (opts?.usage && response.usage) {
        this.accumulateResponsesUsage(usage, response.usage)
      }

      // concatenate text from the output array
      const messages = response.output.filter((o: any) => o.type === 'message') as ResponseOutputMessage[]
      for (const message of messages) {
        for (const content of message.content) {
          if (content.type === 'output_text') {
            text += content.text || ''
          }
        }
      }
      
      // check if we have tool calls
      const toolCalls = response.output?.filter((o: any) => o.type === 'function_call') as ResponseFunctionToolCall[]
      if (toolCalls.length) {

        const followReqInput: any[] = []
        for (const toolCall of toolCalls) {

          // log
          logger.log(`[openai] tool call ${toolCall.name} with ${toolCall.arguments}`)

          // this can error
          let args = null
          try {
            args = JSON.parse(toolCall.arguments)
          } catch (err) {
            throw new Error(`[openai] tool call ${toolCall.name} with invalid JSON args: "${toolCall.arguments}"`, { cause: err })
          }

          // now execute
          const content = await this.callTool({ model: model.id }, toolCall.name, args)
          logger.log(`[openai] tool call ${toolCall.name} => ${JSON.stringify(content).substring(0, 128)}`)

          // store
          followReqInput.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: typeof content === 'string' ? content : JSON.stringify(content),
          })

          // save tool call info
          toolCallInfo.push({
            name: toolCall.name,
            params: args,
            result: content
          })
        
        }

        // build follow-up request
        const followUpReq: ResponseCreateParams = {
          model: model.id,
          previous_response_id: response.id,
          input: followReqInput,
          stream: false,
        }
        
        // debug
        logger.debug('[responses] FOLLOW-UP REQUEST', JSON.stringify(followUpReq, null, 2))

        // continue
        response = await this.client.responses.create(followUpReq)
        continue
      }

      // done
      return {
        type: 'text',
        content: text,
        toolCalls: toolCallInfo,
        openAIResponseId: response?.id,
        ...(opts?.usage ? { usage: usage } : {}),
      }
    }
  }

  async responsesStream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<OpenAIStreamingResponse> {

    // log
    logger.log(`[${this.getName()}] prompting model ${model.id}`)

    const request = await this.buildResponsesRequest(model, thread, opts, true)
    const stream = await this.client.responses.create(request) as AsyncIterable<ResponseStreamEvent>
    logger.debug('[responsesStream] subscribed')

    // async generator bound to preserve class context
    async function* generator(this: any) {
      
      // track the response id
      let responseId: string = ''

      // we need to accumulate usage
      const usage: LlmUsage = zeroUsage()

      // We may need to run multiple streaming passes if the model calls tools.
      let currentStream: AsyncIterable<ResponseStreamEvent> | null = stream
      while (true) {

        // Track function-call tool invocations that the model initiates while streaming.
        // We gather their incremental arguments and execute them once finalized.
        const pendingCalls: ResponseFunctionToolCall[] = []
        let thinking = false

        for await (const ev of currentStream!) {

          switch (ev.type) {

            case 'response.created':
              responseId = ev.response.id
              break

            case 'response.in_progress':
              // nop for us
              break

            case 'response.completed': {
              if (opts?.usage && ev.response.usage) {
                this.accumulateResponsesUsage(usage, ev.response.usage)
              }
              break
            }

            case 'response.output_item.added':
              switch (ev.item.type) {
                
                case 'message':
                  thinking = false
                  break
                
                case 'reasoning':
                  thinking = true
                  break
                
                case 'function_call':
                  
                  // record the tool call
                  pendingCalls.push(ev.item)

                  // first notify
                  yield {
                    type: 'tool',
                    id: ev.item.id,
                    name: ev.item.name,
                    status: this.getToolPreparationDescription(ev.item.name),
                    done: false
                  }

                  // done
                  break
              }
              break

            case 'response.output_item.done':
              switch (ev.item.type) {
                case 'reasoning':
                  thinking = false
                  break
              }
              break

            case 'response.output_text.delta': {
              if (ev.delta) {
                yield {
                  type: thinking ? 'reasoning' : 'content',
                  text: ev.delta,
                  done: false
                }
              }
              break
            }

            case 'response.function_call_arguments.delta': {
              const call = pendingCalls.find(c => c.id == ev.item_id)
              if (call) {
                call.arguments += ev.delta
              }
              break
            }

            case 'response.function_call_arguments.done': {
              const call = pendingCalls.find(c => c.id == ev.item_id)
              if (call) { /* nop */ }
              break
            }

          }

        }

        // if no pending calls we are done
        if (!pendingCalls.length) {
          if (opts?.usage) {
            yield { type: 'usage', usage: usage }
          }
          yield { type: 'content', text: '', done: true }
          break
        }

        // run tool calls
        const followReqInput: any[] = []
        for (const toolCall of pendingCalls) {

          // this can error
          let args = null
          try {
            args = JSON.parse(toolCall.arguments)
          } catch (err) {
            throw new Error(`[openai] tool call ${toolCall.name} with invalid JSON args: "${args}"`, { cause: err })
          }

          // first notify
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.name,
            status: this.getToolRunningDescription(toolCall.name, args),
            call: {
              params: args,
              result: undefined
            },
            done: false
          }

          // now execute
          const content = await this.callTool({ model: model.id }, toolCall.name, args)
          logger.log(`[openai] tool call ${toolCall.name} => ${JSON.stringify(content).substring(0, 128)}`)

          // add
          // followReqInput.push(toolCall)
          
          // store
          followReqInput.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: typeof content === 'string' ? content : JSON.stringify(content),
          })

          // clear
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.name,
            status: this.getToolCompletedDescription(toolCall.name, args, content),
            done: true,
            call: {
              params: args,
              result: content
            },
          }

        }

        // now we can build the follow-up request
        const followReq: ResponseCreateParams = {
          model: model.id,
          previous_response_id: responseId,
          input: followReqInput,
          tools: request.tools,
          tool_choice: request.tool_choice,
          stream: true,
        }
        
        // debug
        logger.debug('[responsesStream] FOLLOW-UP STREAM REQ', JSON.stringify(followReq, null, 2))

        // switch stream
        currentStream = await this.client.responses.create(followReq) as AsyncIterable<ResponseStreamEvent>

      }

    }

    return {
      stream: (generator.bind(this))(),
      context: {
        responsesApi: true,
      } as OpenAIStreamingContext
    }
  }

  private async buildResponsesRequest(model: ChatModel, thread: Message[], opts: LlmCompletionOpts | undefined, stream: boolean): Promise<ResponseCreateParams> {
    
    logger.debug('[buildResponsesRequest] THREAD', JSON.stringify(thread, null, 2))
    
    // If thread elements are already in payload form (not Message instances), use directly
    let payload: any[]
    if (Array.isArray(thread) && thread.length && !(thread[0] instanceof Message)) {
      payload = thread as any[]
    } else {
      payload = this.buildPayload(model, thread as any, opts)
    }
    logger.debug('[buildResponsesRequest] PAYLOAD', JSON.stringify(payload, null, 2))

    // -----------------------------------------------------------
    // Helpers
    function extractText(msg: any): string {
      const c = msg?.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        return c.map((p: any) => typeof p === 'string' ? p : (p.text ?? '')).join('')
      }
      if (c && typeof c === 'object' && typeof c.text === 'string') return c.text
      return JSON.stringify(c)
    }

    // Merge all system messages into a single instructions string
    const instructions = payload
      .filter((m: any) => m.role === 'system')
      .map(extractText)
      .join('\n')
      .trim()

    // Pick the last *user* message; if none exists (thread may be a bare string),
    // fall back to the very last message in the thread.
    const lastUser = [...payload].reverse().find((m: any) => m.role === 'user')
    let userContent = lastUser ? extractText(lastUser) : extractText(payload[payload.length - 1] ?? { content: '' })
    if (!userContent.trim() && payload.length) {
      userContent = extractText(payload[payload.length - 1])
    }

    const req: ResponseCreateParams = {
      model: model.id,
      ...(instructions ? { instructions } : {}),
      ...(opts?.openAIResponseId ? { previous_response_id: opts.openAIResponseId } : {}),
      input: userContent,
      stream,
    }

    // attach tool definitions if any
    const tools = await this.getResponsesTools(model, opts)
    if (tools.length) {
      req.tools = tools
      req.tool_choice = this.getResponsesToolChoice(opts?.toolChoice)
    }

    // done
    return req
  }

  async getResponsesTools(model: ChatModel, opts?: LlmCompletionOpts): Promise<Tool[]> {

    // check if enabled
    if (opts?.tools === false || !model.capabilities?.tools) {
      return []
    }

    // tools
    const tools = await this.getAvailableTools()
    if (!tools.length) return []

    // convert schema for Responses API
    return tools.map((t: LlmTool): Tool => {

      // Function tools carry a JSON schema plus name & description.
      if (t.type === 'function') {

        // clone it
        const parameters = t.function.parameters ? {
            ...JSON.parse(JSON.stringify(t.function.parameters)),
            required: Object.keys(t.function.parameters.properties || {}),
            additionalProperties: false,
          } : {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
          }
        
        // now we need to add additionalProperties: false to items properties
        for (const value of Object.values(parameters.properties) as any) {
          if (value.type === 'array' && value.items && typeof value.items === 'object' && value.items.type === 'object') {
            value.items.required = Object.keys(value.items.properties)
            value.items.additionalProperties = false
          }
        }

        // done
        return {
          type: 'function',
          name: t.function.name,
          description: t.function.description,
          parameters: parameters,
          strict: true
        }
      
      } else {

        // does not exist yet
        throw new Error(`[openai] tool type ${t.type} is not supported in Responses API`)

      }

    })

  }

  private getResponsesToolChoice(toolChoice?: LlmToolChoice): ToolChoiceOptions|ToolChoiceFunction {

    if (!toolChoice) {
      return 'auto'
    }

    switch (toolChoice.type) {
      case 'none':
        return 'none'
      case 'auto':
        return 'auto'
      case 'required':
        return 'required'
      case 'tool':
        return {
          type: 'function',
          name: toolChoice.name
        }
    }

  }

  async continueResponse(model: ChatModel, previousId: string, input: string, opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const req: any = {
      model: model.id,
      input: [{ type: 'message', role: 'user', content: input }],
      previous_response_id: previousId,
      stream: false,
    }
    const toolOpts = await this.getToolsOpts(model, opts)
    if ((toolOpts as any).tools) req.tools = (toolOpts as any).tools

    const resp: any = await (this.client as any).responses.create(req)
    return {
      type: 'text',
      content: (resp.output?.text) ?? '',
      ...(opts?.usage && resp.usage ? { usage: resp.usage } : {}),
    }
  }

  async forkResponse(model: ChatModel, previousId: string, input: string, opts?: LlmCompletionOpts): Promise<LlmResponse> {
    // For fork we simply call continueResponse for now (no server-side diff yet)
    return await this.continueResponse(model, previousId, input, opts)
  }

  private accumulateResponsesUsage(cumulate: LlmUsage, usage: ResponseUsage) {
    cumulate.prompt_tokens += usage.input_tokens
    cumulate.completion_tokens += usage.output_tokens
    cumulate.prompt_tokens_details!.cached_tokens! += usage.input_tokens_details.cached_tokens
    cumulate.completion_tokens_details!.reasoning_tokens! += usage.output_tokens_details.reasoning_tokens
  }

}

