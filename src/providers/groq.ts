import Groq from 'groq-sdk'
import { ChatCompletionChunk, ChatCompletionMessageParam } from 'groq-sdk/resources/chat'
import { ChatCompletionCreateParamsBase } from 'groq-sdk/resources/chat/completions'
import { minimatch } from 'minimatch'
import LlmEngine from '../engine'
import logger from '../logger'
import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelGroq } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingContext, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import { PluginExecutionResult } from '../types/plugin'
import { zeroUsage } from '../usage'

//
// https://console.groq.com/docs/api-reference#chat-create
//

export type GroqStreamingContext = LlmStreamingContext<ChatCompletionMessageParam> & {
  textContent?: string
}

export default class extends LlmEngine {

  client: Groq

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new Groq({
      apiKey: config.apiKey || '',
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
      maxRetries: config.maxRetries
    })
  }

  getId(): string {
    return 'groq'
  }

  // https://console.groq.com/docs/models

  getModelCapabilities(model: ModelGroq): ModelCapabilities {
    const visionGlobs = [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'meta-llama/llama-4-maverick-17b-128e-instruct',
    ]
    return {
      tools: true,
      vision: visionGlobs.some((m) => minimatch(model.id, m)),
      reasoning: model.id.startsWith('o'),
      caching: false,
    }
  }


  async getModels(): Promise<ModelGroq[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    const models = await this.client.models.list()

    // filter and transform
    return models.data
      .filter((model: any) => model.active)  // active not in SDK types
      .filter((model) => !model.id.includes('guard'))
      .filter((model) => !model.id.includes('whisper'))
      .sort((a, b) => b.created - a.created)

  }

  async chat(model: ChatModel, thread: ChatCompletionMessageParam[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    const startTime = Date.now()

    // call
    logger.log(`[groq] prompting model ${model.id}`)
    const response = await this.client.chat.completions.create({
      model: model.id,
      messages: thread,
      ...this.getCompletionOpts(model, opts),
      ...await this.getToolOpts(model, opts),
    });

    // get choice
    const choice = response.choices?.[0]

    // tool call
    if (choice?.finish_reason === 'tool_calls') {

      const toolCalls = choice.message.tool_calls!
      for (const toolCall of toolCalls) {

        // log
        logger.log(`[groq] tool call ${toolCall.function.name} with ${toolCall.function.arguments}`)

        // this can error
        let args = null
        try {
          args = JSON.parse(toolCall.function.arguments)
        } catch (err) {
          throw new Error(`[groq] tool call ${toolCall.function.name} with invalid JSON args: "${toolCall.function.arguments}"`, { cause: err })
        }
        
        // now execute
        let lastUpdate: PluginExecutionResult|undefined = undefined
        for await (const update of this.callTool({ model: model.id, abortSignal: opts?.abortSignal }, toolCall.function.name, args, opts?.toolExecutionValidation)) {
          if (update.type === 'result') {
            lastUpdate = update
          }
        }

        // process result
        const { content, canceled } = this.processToolExecutionResult(
          'groq',
          toolCall.function.name,
          args,
          lastUpdate
        )

        // log
        logger.log(`[groq] tool call ${toolCall.function.name} => ${JSON.stringify(content).substring(0, 128)}`)

        // For non-streaming, throw immediately on cancel
        if (canceled) {
          throw new Error('Tool execution was canceled')
        }

        // add tool call message
        thread.push(choice.message)

        // add tool response message
        thread.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(content)
        })

        // save tool call info
        toolCallInfo.push({
          name: toolCall.function.name,
          params: args,
          result: content
        })
      
      }

      // apply cooldown before next request
      await this.applyCooldown(startTime)

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
        completion.usage.completion_tokens += response.usage.completion_tokens
      }

      // done
      return completion
    
    }    

    // total tokens is not part of our response
    if (response.usage?.total_tokens) {
      // @ts-expect-error "must be optional"???
      delete response.usage.total_tokens
    }

    // return an object
    return {
      type: 'text',
      content: response.choices?.[0].message.content || '',
      toolCalls: toolCallInfo,
      ...(opts?.usage && response.usage ? { usage: response.usage } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse<GroqStreamingContext>> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // context
    const context: GroqStreamingContext = {
      model: model,
      thread: this.buildGroqPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      startTime: 0,
      usage: zeroUsage(),
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }

  }

  async doStream(context: GroqStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []
    context.startTime = Date.now()
    context.textContent = ''

    // call
    logger.log(`[groq] prompting model ${context.model.id}`)
    const stream = this.client.chat.completions.create({
      model: context.model.id,
      messages: context.thread as ChatCompletionMessageParam[],
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts(context.model, context.opts),
      stream: true,
    })

    // done
    return stream

  }

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<ChatCompletionCreateParamsBase, 'model'|'messages'|'stream'> {
    return {
      ...(opts?.maxTokens ? { max_tokens: opts?.maxTokens } : {} ),
      ...(opts?.temperature ? { temperature: opts?.temperature } : {} ),
      //...(opts?.top_k ? { logprobs: true, top_logprobs: opts?.top_k } : {} ),
      ...(opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(opts?.structuredOutput ? { response_format: { type: 'json_object' } } : {} ),
    }
  }

  async getToolOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<ChatCompletionCreateParamsBase, 'model'|'messages'|'stream'>> {

    // disabled?
    if (opts?.tools === false) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    return tools.length ? {
      tools: tools,
      tool_choice: opts?.toolChoice?.type === 'tool' ? {
        type: 'function',
        function: { name: opts.toolChoice.name }
      } : opts?.toolChoice?.type ?? 'auto',
    } : {}

  }

  async stop(stream: LlmStream): Promise<void> {
    stream.controller?.abort()
  }

  syncToolHistoryToThread(context: GroqStreamingContext): void {
    // sync mutations from toolHistory back to thread
    // Groq thread format: { role: 'tool', tool_call_id, name, content }
    for (const entry of context.toolHistory) {
      const threadEntry = context.thread.find(
        (t: any) => t.role === 'tool' && t.tool_call_id === entry.id
      )
      if (threadEntry) {
        threadEntry.content = JSON.stringify(entry.result)
      }
    }
  }

  async *processNativeChunk(chunk: ChatCompletionChunk, context: GroqStreamingContext): AsyncGenerator<LlmChunk> {

    // debug
    //logger.log('processNativeChunk', JSON.stringify(chunk))

    // usage
    if (context.opts?.usage && chunk.x_groq?.usage) {
      context.usage.prompt_tokens += chunk.x_groq.usage.prompt_tokens ?? 0
      context.usage.completion_tokens += chunk.x_groq.usage.completion_tokens ?? 0
    }


    // tool calls - normalize and process
    if (chunk.choices[0]?.delta?.tool_calls?.[0].function) {
      const tool_call = chunk.choices[0].delta.tool_calls[0]
      const fn = tool_call.function!
      const hasId = tool_call.id !== null && tool_call.id !== undefined

      if (hasId) {
        // New tool call - normalize as 'start'
        yield* this.processToolCallChunk({
          type: 'start',
          id: tool_call.id,
          name: fn.name || '',
          args: fn.arguments || '',
          message: chunk.choices[0].delta.tool_calls.map((tc: any) => {
            delete tc.index
            return tc
          }),
        }, context)
      } else {
        // Delta - append to last tool call
        yield* this.processToolCallChunk({
          type: 'delta',
          argumentsDelta: fn.arguments || '',
        }, context)
      }
    }

    // now tool calling
    if (['tool_calls', 'function_call', 'stop'].includes(chunk.choices[0]?.finish_reason|| '') && context.toolCalls?.length) {

      // clear force tool call to avoid infinite loop
      if (context.opts.toolChoice?.type === 'tool') {
        delete context.opts.toolChoice
      }

      // increment round for next iteration
      context.currentRound++

      // execute tool calls using base class method
      yield* this.executeToolCallsSequentially(context.toolCalls, context, {
        formatToolCallForThread: (tc: LlmToolCall) => ({
          role: 'assistant' as const,
          content: context.textContent || '',
          tool_calls: tc.message
        }),
        formatToolResultForThread: (result: any, tc: LlmToolCall) => ({
          role: 'tool' as const,
          tool_call_id: tc.id,
          name: tc.function,
          content: JSON.stringify(result)
        }),
        createNewStream: async () => this.doStream(context)
      })

      // done
      return

    }

    // reasoning
    if (chunk.choices[0].delta.reasoning) {
      
      yield {
        type: 'reasoning',
        text: chunk.choices[0].delta.reasoning,
        done: false
      }
    
    } else if (chunk.choices[0].delta.content) {
      const text = chunk.choices[0].delta.content
      context.textContent = (context.textContent || '') + text

      yield {
        type: 'content',
        text: text,
        done: false
      }

    }

    // normal content
    if (['stop', 'length'].includes(chunk.choices[0].finish_reason || '')) {

      // done
      yield { type: 'content', text: '', done: true }

      // usage?
      if (context.opts?.usage) {
        yield { type: 'usage', usage: context.usage }
      }

    }

  }

  buildGroqPayload(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): ChatCompletionMessageParam[] {

    // default
    let payloads = this.buildPayload<ChatCompletionMessageParam>(model, thread, opts)

    // when using vision models, we cannot use a system prompt (!!)
    let hasImages = false
    for (const p of payloads) {
      if (Array.isArray(p.content)) {
        for (const m of (p.content as any[])) {
          if (m.type == 'image_url') {
            hasImages = true
            break
          }
        }
      }
    }

    // remove system prompt
    if (hasImages) {
      payloads = payloads.filter((p) => p.role != 'system')
    }

    // now return
    return payloads.map((payload) => {
      return {
        role: payload.role,
        content: payload.content,
        ...((payload as any).tool_calls ? {
            tool_calls: (payload as any).tool_calls
        } : {}),
        ...(payload.role === 'tool' ? {
          tool_call_id: (payload as any).tool_call_id,
          name: (payload as any).name
        } : {})
      } as ChatCompletionMessageParam
    })
  }

}
