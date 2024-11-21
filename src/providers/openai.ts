
import { EngineCreateOpts, Model } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import OpenAI, { ClientOptions } from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { Stream } from 'openai/streaming'

const defaultBaseUrl = 'https://api.openai.com/v1'

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
    return [ '*gpt-4o', '*vision*' ]
  }

  modelAcceptsSystemRole(model: string): boolean {
    return !model.startsWith('o1-')
  }

  modelSupportsTools(model: string): boolean {
    return !model.startsWith('o1-')
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    try {
      const response = await this.client.models.list()
      return response.data.map((model: any) => {
        return {
          id: model.id,
          name: model.id,
          meta: model,
        }
      })
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

  protected buildPayload(model: string, thread: Message[] | string): LLmCompletionPayload[] {
    let payload = super.buildPayload(model, thread)
    if (!this.modelAcceptsSystemRole(model)) {
      payload = payload.filter((msg: LLmCompletionPayload) => msg.role !== 'system')
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
      messages: this.buildPayload(model, thread) as Array<any>,
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
    this.currentThread = this.buildPayload(this.currentModel, thread)

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
      stream_options: { include_usage: this.currentOpts?.usage || false },
      //max_tokens: this.currentOpts?.maxTokens,
      stream: true,
    })

    // done
    return stream

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
      if (chunk.choices[0].delta.tool_calls[0].id) {

        // debug
        //logger.log('[${this.getName()}] tool call start:', chunk)

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
        return
      
      } else {

        const toolCall = this.toolCalls[this.toolCalls.length-1]
        toolCall.args += chunk.choices[0].delta.tool_calls[0].function.arguments
        return

      }

    }

    // now tool calling
    if (chunk.choices[0]?.finish_reason === 'tool_calls' || (chunk.choices[0]?.finish_reason === 'stop' && this.toolCalls?.length)) {

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
    const done = chunk.choices[0]?.finish_reason === 'stop'
    if (done) {
      this.streamDone = true
    }

    // text chunk
    if (chunk.choices?.length) {
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

  addAttachmentToPayload(message: Message, payload: LLmCompletionPayload) {
    if (message.attachment) {
      payload.content = [
        { type: 'text', text: message.contentForModel },
        { type: 'image_url', image_url: { url: `data:${message.attachment.mimeType};base64,${message.attachment.content}` } }
      ]
    }
  }

}
