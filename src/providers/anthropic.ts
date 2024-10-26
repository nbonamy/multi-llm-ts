
import { EngineConfig } from 'types/index.d'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmContentPayload, LlmEventCallback, LlmToolCall, LLmCompletionPayload } from 'types/llm.d'
import LlmEngine from '../engine'
import Anthropic from '@anthropic-ai/sdk'
import Message from '../models/message'
import { Stream } from '@anthropic-ai/sdk/streaming'
import { Tool, ImageBlockParam, MessageParam, MessageStreamEvent, TextBlockParam, TextBlock, TextDelta, InputJSONDelta } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'

type AnthropicTool = Tool|BetaToolUnion

export default class extends LlmEngine {

  client: Anthropic
  currentModel: string
  currentSystem: string
  currentThread: Array<MessageParam>
  toolCall: LlmToolCall|null = null

  static isConfigured = (engineConfig: EngineConfig): boolean => {
    return engineConfig?.apiKey?.length > 0
  }
  
 constructor(config: EngineConfig) {
    super(config)
    this.client = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })
  }

  getName(): string {
    return 'anthropic'
  }

  getVisionModels(): string[] {
    return ['*']
  }

  async getModels(): Promise<any[]> {

    // need an api key
    if (!this.client.apiKey) {
      return null
    }

    // do it
    return [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-sonnet-latest', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ]

  }

  getMaxTokens(model: string): number {
    if (model.includes('claude-3-5-sonnet') || model.includes('computer-use')) return 8192
    else return 4096
  }

  async complete(thread: Message[], opts: LlmCompletionOpts): Promise<LlmResponse> {

    // model
    let model = opts?.model || this.config.model.chat

    // call
    console.log(`[anthropic] prompting model ${model}`)
    const response = await this.client.messages.create({
      model: model,
      system: thread[0].content,
      max_tokens: this.getMaxTokens(model),
      messages: this.buildPayload(thread, model),
    });

    // return an object
    const content = response.content[0] as TextBlock
    return {
      type: 'text',
      content: content.text
    }
  }

  async stream(thread: Message[], opts: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(thread, opts?.model || this.getChatModel())
  
    // save the message thread
    this.currentSystem = thread[0].content
    this.currentThread = this.buildPayload(thread, this.currentModel)
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCall = null

    // tools in anthropic format
    const tools: AnthropicTool[] = (await this.getAvailableTools()).map((tool) => {
      return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: {
          type: 'object',
          properties: tool.function.parameters.properties,
          required: tool.function.parameters.required,
        }
      }
    })

    console.log(`[anthropic] prompting model ${this.currentModel}`)
    return this.client.messages.create({
      model: this.currentModel,
      system: this.currentSystem,
      max_tokens: this.getMaxTokens(this.currentModel),
      messages: this.currentThread,
      tool_choice: { type: 'auto' },
      tools: tools as Tool[],
      stream: true,
    })

  }

  async stop(stream: Stream<any>) {
    stream.controller.abort()
  }
   
  async streamChunkToLlmChunk(chunk: MessageStreamEvent, eventCallback: LlmEventCallback): Promise<LlmChunk|null> {
    
    // log
    //console.log('[anthropic] received chunk', chunk)

    // done
    if (chunk.type == 'message_stop') {
      return { text: '', done: true }
    }

    // block start
    if (chunk.type == 'content_block_start') {
      if (chunk.content_block.type == 'tool_use') {

        // record the tool call
        this.toolCall = {
          id: chunk.content_block.id,
          message: '',
          function: chunk.content_block.name,
          args: ''
        }

        // notify
        eventCallback?.call(this, {
          type: 'tool',
          content: this.getToolPreparationDescription(this.toolCall.function)
        })
        
      } else {
        this.toolCall = null
      }
    }

    // block delta
    if (chunk.type == 'content_block_delta') {

      // text
      if (this.toolCall === null) {
        const textDelta = chunk.delta as TextDelta
        return { text: textDelta.text, done: false }
      }

      // tool us
      if (this.toolCall !== null) {
        const toolDelta = chunk.delta as InputJSONDelta
        this.toolCall.args += toolDelta.partial_json
      }

    }

    // tool call?
    if (chunk.type == 'message_delta') {
      if (chunk.delta.stop_reason == 'tool_use' && this.toolCall !== null) {

        // first notify
        eventCallback?.call(this, {
          type: 'tool',
          content: this.getToolRunningDescription(this.toolCall.function)
        })

        // now execute
        const args = JSON.parse(this.toolCall.args)
        console.log(`[anthropic] tool call ${this.toolCall.function} with ${JSON.stringify(args)}`)
        const content = await this.callTool(this.toolCall.function, args)
        console.log(`[anthropic] tool call ${this.toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool call message
        this.currentThread.push({
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: this.toolCall.id,
            name: this.toolCall.function,
            input: args,
          }]
        })

        // add tool response message
        if (this.toolCall.function === 'computer') {
          this.currentThread.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: this.toolCall.id,
              ...content,
            }]
          })
        } else {
          this.currentThread.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: this.toolCall.id,
              content: JSON.stringify(content)
            }]
          })
        }

        // clear
        eventCallback?.call(this, {
          type: 'tool',
          content: null,
        })

        // switch to new stream
        eventCallback?.call(this, {
          type: 'stream',
          content: await this.doStream(),
        })

      }

    }

    // unknown
    return null

  }

  addImageToPayload(message: Message, payload: MessageParam) {
    payload.content = [
      { type: 'text', text: message.content },
      { type: 'image', source: {
        type: 'base64',
        media_type: message.attachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: message.attachment.contents,
      }}
    ]
  }

  buildPayload(thread: Message[], model: string): Array<MessageParam> {
    const payload: LLmCompletionPayload[] = super.buildPayload(thread, model)
    return payload.filter((payload) => payload.role != 'system').map((payload): MessageParam => {
      if (typeof payload.content == 'string') {
        return {
          role: payload.role,
          content: payload.content
        }
      } else {
        return {
          role: payload.role,
          content: payload.content.map((content: LlmContentPayload): TextBlockParam|ImageBlockParam => {
            if (content.type == 'image') {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: content.source.media_type,
                  data: content.source.data,
                }
              }
            } else {
              return {
                type: 'text',
                text: content.text
              }
            }
          })
        }
      }
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async image(prompt: string, opts: LlmCompletionOpts): Promise<LlmResponse|null> {
    return null    
  }
}
