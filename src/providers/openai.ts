
import { EngineCreateOpts, Model } from 'types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmRole, LlmStream, LlmToolCall } from 'types/llm'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import OpenAI, { ClientOptions } from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions'
import { Stream } from 'openai/streaming'

const defaultBaseUrl = 'https://api.openai.com/v1'

//
// https://platform.openai.com/docs/api-reference/introduction
// 

export default class extends LlmEngine {

  client: OpenAI
  currentModel: string = ''
  currentThread: LLmCompletionPayload[] = []
  currentOpts: LlmCompletionOpts|null = null
  toolCalls: LlmToolCall[] = []
  streamDone: boolean = false

  constructor(config: EngineCreateOpts, opts?: ClientOptions) {
    super(config)
    this.client = new OpenAI({
      apiKey: opts?.apiKey || config.apiKey,
      baseURL: opts?.baseURL || config.baseURL || defaultBaseUrl,
      dangerouslyAllowBrowser: true
    })
  }

  getName(): string {
    return 'openai'
  }

  // https://openai.com/api/pricing/
  getVisionModels(): string[] {
    return [ 'o1', '*gpt-4o', '*vision*' ]
  }

  modelAcceptsSystemRole(model: string): boolean {
    return !model.startsWith('o1')
  }

  modelSupportsTools(model: string): boolean {
    return !model.startsWith('o1-')
  }

  modelIsReasoning(model: string): boolean {
    return model.startsWith('o')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsMaxTokens(model: string): boolean {
    return true
  }

  modelSupportsTemperature(model: string): boolean {
    return !this.modelIsReasoning(model)
  }

  modelSupportsTopP(model: string): boolean {
    return !this.modelIsReasoning(model)
  }

  modelSupportsTopK(model: string): boolean {
    return !this.modelIsReasoning(model)
  }

  modelSupportsReasoningEffort(model: string): boolean {
    return this.modelIsReasoning(model)
  }

  get systemRole(): LlmRole {
    return 'system'//'developer'
  }

  async getModels(): Promise<Model[]> {

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
      return models.map((model: any) => ({
        id: model.id,
        name: model.id,
        meta: model,
      }))
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

  protected buildPayload(model: string, thread: Message[] | string, opts?: LlmCompletionOpts): LLmCompletionPayload[] {
    let payload = super.buildPayload(model, thread, opts)
    if (!this.modelAcceptsSystemRole(model)) {
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

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // set baseURL on client
    this.setBaseURL()

    // call
    logger.log(`[${this.getName()}] prompting model ${model}`)
    const response = await this.client.chat.completions.create({
      model: model,
      messages: this.buildPayload(model, thread, opts) as Array<any>,
      ...this.getCompletionOpts(this.currentModel, opts),
    });

    // done
    return {
      type: 'text',
      content: response.choices?.[0].message.content || '',
      ...(opts?.usage && response.usage ? { usage: response.usage } : {}),
    }

  }

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // set baseURL on client
    this.setBaseURL()

    // model: switch to vision if needed
    this.currentModel = this.selectModel(model, thread, opts)

    // save the message thread
    this.currentThread = this.buildPayload(this.currentModel, thread, opts)

    // save the opts and do it
    this.streamDone = false
    this.currentOpts = opts || null
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    // tools
    const tools = await this.getAvailableTools()

    // call
    logger.log(`[${this.getName()}] prompting model ${this.currentModel}`)
    const stream = this.client.chat.completions.create({
      model: this.currentModel,
      // @ts-expect-error strange error
      // LlmRole overlap the different roles ChatCompletionMessageParam
      // but tsc says Type 'LlmRole' is not assignable to type '"assistant"'
      messages: this.currentThread,
      ...(this.modelSupportsTools(this.currentModel) && tools.length ? {
        tools: tools,
        tool_choice: 'auto',
      } : {}),
      ...this.getCompletionOpts(this.currentModel, this.currentOpts || {}),
      stream_options: { include_usage: this.currentOpts?.usage || false },
      stream: true,
    })

    // done
    return stream

  }

  getCompletionOpts(model: string, opts?: LlmCompletionOpts): Omit<ChatCompletionCreateParamsBase, 'model'|'messages'|'stream'> {
    return {
      ...(this.modelSupportsMaxTokens(model) && opts?.maxTokens ? { max_completion_tokens: opts?.maxTokens } : {} ),
      ...(this.modelSupportsTemperature(model) && opts?.temperature ? { temperature: opts?.temperature } : {} ),
      ...(this.modelSupportsTopK(model) && opts?.top_k ? { logprobs: true, top_logprobs: opts?.top_k } : {} ),
      ...(this.modelSupportsTopP(model) && opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(this.modelSupportsReasoningEffort(model) && opts?.reasoningEffort ? { reasoning_effort: opts?.reasoningEffort } : {}),
    }
  }

  async stop(stream: Stream<any>) {
    await stream?.controller?.abort()
  }

  async *nativeChunkToLlmChunk(chunk: ChatCompletionChunk): AsyncGenerator<LlmChunk, void, void> {

    // debug
    //logger.log('nativeChunkToLlmChunk', chunk)

    // tool calls
    if (chunk.choices[0]?.delta?.tool_calls?.[0].function) {

      // arguments or new tool?
      if (chunk.choices[0].delta.tool_calls[0].id !== null && chunk.choices[0].delta.tool_calls[0].id !== undefined) {

        // debug
        //logger.log(`[${this.getName()}] tool call start:`, chunk)

        // record the tool call
        const toolCall: LlmToolCall = {
          id: chunk.choices[0].delta.tool_calls[0].id,
          message: chunk.choices[0].delta.tool_calls.map((tc: any) => {
            delete tc.index
            return tc
          }),
          function: chunk.choices[0].delta.tool_calls[0].function.name || '',
          args: chunk.choices[0].delta.tool_calls[0].function.arguments || '',
        }
        this.toolCalls.push(toolCall)

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // done
        //return
      
      } else {

        // append arguments
        const toolCall = this.toolCalls[this.toolCalls.length-1]
        toolCall.args += chunk.choices[0].delta.tool_calls[0].function.arguments

        // done
        //return

      }

    }

    // now tool calling
    if (['tool_calls', 'function_call', 'stop'].includes(chunk.choices[0]?.finish_reason|| '') && this.toolCalls?.length) {

      // iterate on tools
      for (const toolCall of this.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function),
          done: false
        }

        // now execute
        const args = JSON.parse(toolCall.args)
        logger.log(`[${this.getName()}] tool call ${toolCall.function} with ${JSON.stringify(args)}`)
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[${this.getName()}] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool call message
        this.currentThread.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCall.message
        })

        // add tool response message
        this.currentThread.push({
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
        stream: await this.doStream(),
      }

      // done
      return

    }

    // done?
    const done = ['stop', 'length', 'content_filter', 'eos'].includes(chunk.choices[0]?.finish_reason || '')
    if (done) {
      this.streamDone = true
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
    if (this.currentOpts?.usage && this.streamDone && chunk.usage) {
      yield {
        type: 'usage',
        usage: chunk.usage
      }
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addTextToPayload(message: Message, payload: LLmCompletionPayload, opts: LlmCompletionOpts) {
    if (message.attachment) {
      payload.content = [
        { type: 'text', text: message.contentForModel },
        { type: 'text', text: message.attachment.content }
      ]
    }
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(message: Message, payload: LLmCompletionPayload, opts: LlmCompletionOpts) {
    if (message.attachment) {
      payload.content = [
        { type: 'text', text: message.contentForModel },
        { type: 'image_url', image_url: { url: `data:${message.attachment.mimeType};base64,${message.attachment.content}` } }
      ]
    }
  }

}
