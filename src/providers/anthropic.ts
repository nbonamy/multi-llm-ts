
import { EngineConfig } from 'types/index.d'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmContentPayload, LlmToolCall, LLmCompletionPayload } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'
import Plugin from '../plugin'

import Anthropic from '@anthropic-ai/sdk'
import { Stream } from '@anthropic-ai/sdk/streaming'
import { Tool, ImageBlockParam, MessageParam, MessageStreamEvent, TextBlockParam, TextBlock, TextDelta, InputJSONDelta } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'

type AnthropicTool = Tool|BetaToolUnion

export interface AnthropicComputerToolInfo {
  plugin: Plugin
  screenSize(): { width: number, height: number }
  screenNumber (): number
}

export default class extends LlmEngine {

  client: Anthropic
  currentModel: string
  currentSystem: string
  currentThread: Array<MessageParam>
  toolCall: LlmToolCall|null = null
  computerInfo: AnthropicComputerToolInfo|null = null

 constructor(config: EngineConfig, computerInfo: AnthropicComputerToolInfo = null) {
    super(config)
    this.client = new Anthropic({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })
    this.computerInfo = computerInfo
  }

  getName(): string {
    return 'anthropic'
  }

  getVisionModels(): string[] {
    return ['*']
  }

  getComputerUseRealModel(): string {
    return 'claude-3-5-sonnet-20241022'
  }

  async getModels(): Promise<any[]> {

    // need an api key
    if (!this.client.apiKey) {
      return null
    }

    // do it
    const models = [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-sonnet-latest', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ]

    // depends on platform
    if (this.computerInfo) {
      models.push({ id: 'computer-use', name: 'Computer Use' })
    }

    // done
    return models

  }

  getMaxTokens(model: string): number {
    if (model.includes('claude-3-5-sonnet') || model.includes('computer-use')) return 8192
    else return 4096
  }

  async complete(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // model
    let model = opts?.model || this.config.model.chat
    if (model === 'computer-use') {
      model = this.getComputerUseRealModel()
    }

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

  async stream(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(thread, opts?.model || this.getChatModel())
  
    // add computer tools
    if (this.computerInfo && this.currentModel === 'computer-use') {
      if (!this.plugins['computer']) {
        this.plugins['computer'] = this.computerInfo.plugin
      }
    }
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

    // add computer tools
    if (this.currentModel === 'computer-use') {
      const scaledScreenSize = this.computerInfo.screenSize()
      tools.push({
        name: 'computer',
        type: 'computer_20241022',
        display_width_px: scaledScreenSize.width,
        display_height_px: scaledScreenSize.height,
        display_number: this.computerInfo.screenNumber()
      })
    }

    // call
    if (this.currentModel === 'computer-use') {
      return this.doStreamBeta(tools)
    } else {
      return this.doStreamNormal(tools)
    }

  }

  async doStreamNormal(tools: AnthropicTool[]): Promise<LlmStream> {

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

  async doStreamBeta(tools: AnthropicTool[]): Promise<LlmStream> {
    console.log(`[anthropic] prompting model ${this.currentModel}`)
    return this.client.beta.messages.create({
      model: this.getComputerUseRealModel(),
      betas: [ 'computer-use-2024-10-22' ],
      system: this.currentSystem,
      max_tokens: this.getMaxTokens(this.currentModel),
      messages: this.currentThread,
      tool_choice: { type: 'auto' },
      tools: tools,
      stream: true,
    })
  }
  
  async stop(stream: Stream<any>) {
    stream.controller.abort()
  }
   
  async *nativeChunkToLlmChunk(chunk: MessageStreamEvent): AsyncGenerator<LlmChunk, void, void> {
    
    // log
    //console.log('[anthropic] received chunk', chunk)

    // done
    if (chunk.type == 'message_stop') {
      yield { type: 'content', text: '', done: true }
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
        yield {
          type: 'tool',
          text: this.getToolPreparationDescription(this.toolCall.function),
          done: false
        }
        
      } else {
        this.toolCall = null
      }
    }

    // block delta
    if (chunk.type == 'content_block_delta') {

      // text
      if (this.toolCall === null) {
        const textDelta = chunk.delta as TextDelta
        yield { type: 'content', text: textDelta.text, done: false }
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
        yield {
          type: 'tool',
          text: this.getToolRunningDescription(this.toolCall.function),
          done: false
        }

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
        yield {
          type: 'tool',
          done: true,
        }

        // switch to new stream
        yield {
          type: 'stream',
          stream: await this.doStream(),
        }

      }

    }

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
  async image(prompt: string, opts?: LlmCompletionOpts): Promise<LlmResponse|null> {
    return null    
  }
}
