import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMetadata, ModelOpenAI } from '../types/index'

import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmRole, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo, LlmUsage } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import { zeroUsage } from '../usage'
import logger from '../logger'

import OpenAI, { ClientOptions } from 'openai'
import { CompletionUsage } from 'openai/resources'
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions'
import { zodResponseFormat } from 'openai/helpers/zod'
import { minimatch } from 'minimatch'

// Minimal interface for OpenAI Responses API requests
interface OpenAIResponsesRequest {
  model: string
  input: string
  stream: boolean
  instructions?: string
  previous_response_id?: string
  tools?: unknown[]
  tool_choice?: string
}

const defaultBaseUrl = 'https://api.openai.com/v1'

//
// https://platform.openai.com/docs/api-reference/introduction
// 

export type OpenAIStreamingContext = LlmStreamingContextTools & {
  thinking: boolean
  done?: boolean
}

export default class extends LlmEngine {

  client: OpenAI
  private lastResponseId?: string

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
    return model.id.startsWith('o3')
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
      return this.responses(model, thread as any, opts)
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

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

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

  async getToolsOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<ChatCompletionCreateParamsBase, 'model' | 'messages' | 'stream'>> {

    // check if enabled
    if (opts?.tools === false || !model.capabilities?.tools) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    if (!tools.length) return {}

    // convert schema for Responses API if applicable
    if (this.shouldUseResponsesApi(model, opts)) {
      return { tools: this.transformTools(tools) }
    }

    // default chat-completions style
    return {
      tools: tools,
      tool_choice: opts?.toolChoice?.type === 'tool' ? {
        type: 'function',
        function: { name: opts.toolChoice.name }
      } : opts?.toolChoice?.type ?? 'auto',
    }

  }

  // ---------------------------------------------------------------------------
  // Responses API – via official SDK
  // ---------------------------------------------------------------------------
  // Helpers
  private async executeToolCalls(model: ChatModel, calls: Array<{ call_id: string; name: string; arguments: any }>): Promise<Array<{ call_id: string; name: string; content: unknown }>> {
    const outputs: { call_id: string; name: string; content: unknown }[] = []
    for (const call of calls) {
      let argsObj: any = call.arguments
      if (typeof argsObj === 'string') {
        try {
          argsObj = JSON.parse(argsObj)
        } catch (parseErr) {
          logger.debug(`[executeToolCalls] Failed to parse JSON args for call ${call.call_id}: ${argsObj}`, parseErr)
        }
      }
      try {
        const content = await this.callTool({ model: model.id }, call.name, argsObj)
        outputs.push({ call_id: call.call_id, name: call.name, content })
      } catch (toolErr) {
        logger.debug(`[executeToolCalls] Error executing tool ${call.name} (${call.call_id}): ${toolErr}`)
        outputs.push({ call_id: call.call_id, name: call.name, content: { error: String(toolErr) } })
      }
    }
    return outputs
  }


  private extractToolCallsFromResponse(resp: any): Array<{ call_id: string; name: string; arguments: any }> {
    const calls: any[] = []
    const output = resp?.output ?? resp?.data?.output ?? []
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item?.type === 'function_call') {
          calls.push({
            call_id: item.call_id ?? item.id,
            name: item.name,
            arguments: item.arguments,
          })
        }
      }
    }
    return calls
  }

  // ---------------------------------------------------------------------------
  // Responses API – via official SDK with automatic tool execution
  async responses(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // Build request for Responses API
    const request = this.buildResponsesRequest(model, thread, opts, false)
    // attach tool definitions if any
    const toolOpts = await this.getToolsOpts(model, opts)
    if ((toolOpts as any).tools) {
      (request as any).tools = (toolOpts as any).tools
      if ((toolOpts as any).tool_choice) {
        (request as any).tool_choice = (toolOpts as any).tool_choice
      }
    }

    logger.debug('[responses] REQUEST', JSON.stringify(request, null, 2))
    // Call the official SDK
    // NB: "responses" is still beta; cast to any to silence narrow typings until it stabilises.
    let response: any = await (this.client as any).responses.create(request)

    // ------------------------------------------------------------
    // If the model issued tool calls, execute them and send back!
    // ------------------------------------------------------------
    const calls = this.extractToolCallsFromResponse(response)
    if (calls.length) {
      const tool_outputs = await this.executeToolCalls(model, calls)
      logger.debug('[responses] TOOL OUTPUTS', JSON.stringify(tool_outputs, null, 2))

      // Convert tool outputs to the Responses API "function_call_output" input items
      const followUpInput = tool_outputs.map((o: any) => ({
        type: 'function_call_output',
        call_id: o.call_id,
        output: typeof o.content === 'string' ? o.content : JSON.stringify(o.content),
      }))

      const followUpReq: any = {
        model: model.id,
        previous_response_id: response.id ?? response.data?.id,
        input: followUpInput,
        stream: false,
      }
      logger.debug('[responses] FOLLOW-UP REQUEST', JSON.stringify(followUpReq, null, 2))
      response = await (this.client as any).responses.create(followUpReq)
    }

    // update responseId tracking
    this.lastResponseId = response?.id ?? response?.data?.id ?? this.lastResponseId
    logger.debug('[responses] RESPONSE', response)

    // Aggregate text from the output array – handle several shapes
    let text = ''
    // Handle different Response API shapes
    if (Array.isArray(response.output)) {
      for (const item of response.output) {
        // Shape 1: message wrapper
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const piece of item.content) {
            if (piece.type === 'text' && piece.text) {
              text += piece.text
            }
          }
          continue
        }
        // Shape 2: direct content pieces
        if (item.type === 'text' && item.text) {
          text += item.text
          continue
        }
        // Shape 3: message nested under .message
        if (item.message?.content && Array.isArray(item.message.content)) {
          for (const piece of item.message.content) {
            if (piece.type === 'text' && piece.text) {
              text += piece.text
            }
          }
        }
      }
    } else if (response.output?.content && Array.isArray(response.output.content)) {
      // Shape 4: single message object with .content array
      for (const piece of response.output.content) {
        if (piece.type === 'text' && piece.text) {
          text += piece.text
        }
      }
    }

    if (!text && typeof response.output_text === 'string') {
      text = response.output_text as string
    } else if (!text && typeof response.output === 'string') {
      text = response.output as string
    } else if (!text && response.output?.text) {
      text = response.output.text
    }

    return {
      type: 'text',
      content: text,
      ...(opts?.usage && response.usage ? { usage: response.usage } : {}),
    }
  }

  async responsesStream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {
    const request = this.buildResponsesRequest(model, thread, opts, true)
    // attach tool definitions if any
    const toolOpts = await this.getToolsOpts(model, opts)
    if ((toolOpts as any).tools) {
      (request as any).tools = (toolOpts as any).tools
      if ((toolOpts as any).tool_choice) {
        (request as any).tool_choice = (toolOpts as any).tool_choice
      }
    }

    const stream = await (this.client as any).responses.create(request) as AsyncIterable<any>
    logger.debug('[responsesStream] subscribed')

    // async generator bound to preserve class context
    async function* generator(this: any) {
      // We may need to run multiple streaming passes if the model calls tools.
      let currentStream: AsyncIterable<any> | null = stream as any
      while (currentStream) {
        // Track function-call tool invocations that the model initiates while streaming.
        // We gather their incremental arguments and execute them once finalized.
        const pendingCalls: Array<{ call_id: string; name: string; arguments: any }> = []
        let responseId: string | undefined

        for await (const ev of currentStream as any) {
          const type = ev.event ?? ev.type
          switch (type) {
            case 'outputTextDelta':
            case 'output_text_delta':
            case 'response.output_text.delta': {
              const rawDelta: any = ev.delta ?? ev.data?.delta ?? ev.data ?? ev.text
              const txt = typeof rawDelta === 'string' ? rawDelta : (rawDelta?.delta ?? rawDelta?.text ?? '')
              if (txt) {
                yield { type: 'content', text: txt, done: false }
              }
              break
            }
            case 'response.output_text': {
              const raw: any = ev.text ?? ev.data?.text ?? ev.data
              const txt = typeof raw === 'string' ? raw : (raw?.text ?? '')
              if (txt) {
                yield { type: 'content', text: txt, done: false }
              }
              break
            }
            case 'response.completed': {
              responseId = ev.data?.id ?? ev.id
              yield { type: 'content', text: '', done: true }
              if (opts?.usage && ev.usage) {
                yield { type: 'usage', usage: ev.usage }
              }
              break
            }
            case 'toolCallCreated':
            case 'tool_call_created':
              pendingCalls.push({ call_id: ev.data?.id ?? ev.id, name: ev.data?.name, arguments: '' })
              yield { type: 'toolCall', id: ev.data?.id ?? ev.id }
              break
            // --------------------------------------------------------------------
            // Responses API – function-call streaming (new o3/o4 models)
            // --------------------------------------------------------------------
            case 'response.function_call_arguments.delta': {
              const id = ev.item_id ?? ev.data?.item_id ?? ev.id
              const delta: string = ev.delta ?? ev.data?.delta ?? ev.data?.arguments_delta ?? ''
              if (!delta) break
              let call = pendingCalls.find(c => c.call_id === id)
              if (!call) {
                call = { call_id: id, name: ev.data?.name ?? ev.name ?? '', arguments: '' }
                pendingCalls.push(call)
                // Notify caller that a new tool call has started
                yield { type: 'toolCall', id }
              }
              call.arguments += delta
              break
            }
            case 'response.function_call_arguments.done': {
              const id = ev.item_id ?? ev.data?.item_id ?? ev.id
              const call = pendingCalls.find(c => c.call_id === id)
              if (call) {
                // Emit the finalized tool call block to the consumer
                yield { type: 'toolCallDone', id, args: call.arguments }
              }
              break
            }

            // --------------------------------------------------------------------
            // Legacy aliases kept for backward-compatibility: real OpenAI streams still emit these until SDK ≥ 5.0.1 removes them
            // --------------------------------------------------------------------
            case 'toolCallArguments':
            case 'tool_call_arguments': {
              const id = ev.data?.id ?? ev.id
              const delta: string = ev.data?.arguments_delta ?? ev.arguments_delta ?? ''
              if (!delta) break
              let call = pendingCalls.find(c => c.call_id === id)
              if (!call) {
                call = { call_id: id, name: ev.data?.name ?? '', arguments: '' }
                pendingCalls.push(call)
                yield { type: 'toolCall', id }
              }
              call.arguments += delta
              break
            }
            case 'toolCallDone':
            case 'tool_call_done': {
              const id = ev.data?.id ?? ev.id
              const call = pendingCalls.find(c => c.call_id === id)
              yield { type: 'toolCallDone', id, args: call?.arguments }
              break
            }
            case 'done':
              yield { type: 'content', text: '', done: true }
              break
            default:
              // ignore
              break
          }
        }


        // If tool calls collected, execute them and request follow-up stream
        if (pendingCalls.length) {
          const tool_outputs = await this.executeToolCalls(model, pendingCalls)
          const followInput = tool_outputs.map((o: any) => ({
            type: 'function_call_output',
            call_id: o.call_id,
            output: typeof o.content === 'string' ? o.content : JSON.stringify(o.content),
          }))
          const followReq: OpenAIResponsesRequest = {
            model: model.id,
            previous_response_id: responseId,
            input: followInput,
            stream: true,
          }
          if ((toolOpts as any).tools) {
            followReq.tools = (toolOpts as any).tools;
            if ((toolOpts as any).tool_choice) {
              followReq.tool_choice = (toolOpts as any).tool_choice;
            }
          }
          logger.debug('[responsesStream] FOLLOW-UP STREAM REQ', JSON.stringify(followReq, null, 2))
          currentStream = await (this.client as any).responses.create(followReq)
          // continue outer while loop to process new stream
          continue
        }

        // otherwise we are done
        currentStream = null
      }
    }

    return { stream: (generator.bind(this))(), context: {} }
  }

  async stop(stream: LlmStream) {
    stream?.controller?.abort()
  }

  async *nativeChunkToLlmChunk(chunk: any, context: OpenAIStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // Passthrough for already-normalized Responses API chunks
    // If the provider has already converted this piece into our standardized
    // LlmChunk shape (e.g. via responsesStream), we can forward it directly.
    // Simply check for the `type` discriminator that all normalized chunks use.
    if (chunk && typeof chunk === 'object' && 'type' in chunk) {
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

    // Fallback mapping for Responses API
    const altInput = (usage as any).input_tokens as number | undefined
    const altOutput = (usage as any).output_tokens as number | undefined
    const altReasoning = (usage as any).reasoning_tokens as number | undefined
    if (altInput !== undefined) {
      usage.prompt_tokens = (usage.prompt_tokens ?? 0) + altInput
    }
    if (altOutput !== undefined) {
      usage.completion_tokens = (usage.completion_tokens ?? 0) + altOutput
    }
    if (altReasoning !== undefined) {
      if (!usage.completion_tokens_details) {
        // initialise partial structure when absent
        usage.completion_tokens_details = { reasoning_tokens: 0 } as any
      }
      usage.completion_tokens_details!.reasoning_tokens = (usage.completion_tokens_details!.reasoning_tokens ?? 0) + altReasoning
    }

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

  private buildResponsesRequest(model: ChatModel, thread: Message[], opts: LlmCompletionOpts | undefined, stream: boolean): OpenAIResponsesRequest {
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

    const req: any = {
      model: model.id,
      // The Responses API expects the *raw* user input string — NOT a message wrapper.
      input: userContent,
      stream,
    }
    if (instructions) req.instructions = instructions
    if (this.lastResponseId) req.previous_response_id = this.lastResponseId
    return req
  }

  // ---------------------------------------------------------------------------
  // Converts internal tool definitions to the schema required by the OpenAI SDK.
  // Ensures every entry contains the mandatory `type` field so we avoid
  // "Missing required parameter: 'tools[0].type'" errors when calling the
  // Responses API on o3/o4 models.
  private transformTools(internal: any[]): any[] {
    return (internal ?? []).map((t: any) => {
      // Internal objects may expose either `type` or legacy `kind`.
      const kind = (t.kind ?? t.type) as string

      // Function tools carry a JSON schema plus name & description.
      if (kind === 'function') {
        const fn = t.function ?? {
          name: t.name,
          description: t.description,
          parameters: t.jsonSchema || t.input_schema || t.parameters,
        }
        return {
          type: 'function',
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters ?? { type: 'object', properties: {} },
        }
      }

      // Hosted built-ins such as web_search_preview / code_interpreter
      return { type: kind }
    })
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers for stateful continuation / forking
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

}

