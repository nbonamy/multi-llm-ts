
import { EngineCreateOpts, Model } from 'types/index.d'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmContentPayload, LlmToolCall, LLmCompletionPayload, LLmContentPayloadImageAnthropic, LLmContentPayloadText } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'
import Plugin from '../plugin'
import logger from '../logger'

import Anthropic from '@anthropic-ai/sdk'
import { Stream } from '@anthropic-ai/sdk/streaming'
import { Tool, ImageBlockParam, MessageParam, MessageStreamEvent, TextBlockParam, TextBlock, TextDelta, InputJSONDelta, Usage, RawMessageStartEvent, RawMessageDeltaEvent, MessageDeltaUsage } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'

type AnthropicTool = Tool|BetaToolUnion

export interface AnthropicComputerToolInfo {
  plugin: Plugin
  screenSize(): { width: number, height: number }
  screenNumber (): number
}

export default class extends LlmEngine {

  client: Anthropic
  currentModel: string = ''
  currentSystem: string = ''
  currentThread: MessageParam[] = []
  currentOpts: LlmCompletionOpts|null = null
  currentUsage: Usage|null = null
  toolCall: LlmToolCall|null = null
  computerInfo: AnthropicComputerToolInfo|null = null

 constructor(config: EngineCreateOpts, computerInfo: AnthropicComputerToolInfo|null = null) {
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
  
  // https://docs.anthropic.com/en/docs/about-claude/models
  getVisionModels(): string[] {
    return [
      'claude-3-5-sonnet-latest',
      'claude-3-sonnet-20240229',
      'claude-3-opus-20240229',
      'claude-3-haiku-20240307'
    ]
  }

  getComputerUseRealModel(): string {
    return 'claude-3-5-sonnet-20241022'
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    const models = [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
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

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // model
    if (model === 'computer-use') {
      model = this.getComputerUseRealModel()
    }

    // call
    logger.log(`[anthropic] prompting model ${model}`)
    const response = await this.client.messages.create({
      model: model,
      system: thread[0].contentForModel,
      max_tokens: this.getMaxTokens(model),
      messages: this.buildPayload(model, thread) as MessageParam[],
    });

    // return an object
    const content = response.content[0] as TextBlock
    return {
      type: 'text',
      content: content.text,
      ...(opts?.usage && response.usage ? { usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
      } } : {}),
    }
  }

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(model, thread, opts)
  
    // add computer tools
    if (this.computerInfo && this.currentModel === 'computer-use') {
      const computerUse = this.plugins.find((p) => p.getName() === this.computerInfo!.plugin.getName())
      if (!computerUse) {
        this.plugins.push(this.computerInfo.plugin)
      }
    }

    // save the message thread
    this.currentSystem = thread[0].contentForModel
    this.currentThread = this.buildPayload(this.currentModel, thread) as MessageParam[]

    // save the opts and do it
    this.currentOpts = opts || null
    this.currentUsage = { input_tokens: 0, output_tokens: 0 }
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
    if (this.computerInfo && this.currentModel === 'computer-use') {
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

    logger.log(`[anthropic] prompting model ${this.currentModel}`)
    return this.client.messages.create({
      model: this.currentModel,
      system: this.currentSystem,
      max_tokens: this.getMaxTokens(this.currentModel),
      messages: this.currentThread,
      ...(!this.currentOpts?.disableTools && tools?.length ? {
        tool_choice: { type: 'auto' },
        tools: tools as Tool[]
      } : {}),
      stream: true,
    })

  }

  async doStreamBeta(tools: AnthropicTool[]): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${this.currentModel}`)
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
    //logger.log('[anthropic] received chunk', chunk)

    // usage
    const usage: Usage|MessageDeltaUsage = (chunk as RawMessageStartEvent).message?.usage ?? (chunk as RawMessageDeltaEvent).usage
    if (this.currentUsage && usage) {
      if ('input_tokens' in usage) {
        this.currentUsage.input_tokens += (usage as Usage).input_tokens ?? 0
      }
      this.currentUsage.output_tokens += usage.output_tokens ?? 0
    }

    // done
    if (chunk.type == 'message_stop') {
      yield { type: 'content', text: '', done: true }
      if (this.currentUsage && this.currentOpts?.usage) {
        yield { type: 'usage', usage: {
          prompt_tokens: this.currentUsage.input_tokens,
          completion_tokens: this.currentUsage.output_tokens,
        }}
      }
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
          name: this.toolCall.function,
          status: this.getToolPreparationDescription(this.toolCall.function),
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
          name: this.toolCall.function,
          status: this.getToolRunningDescription(this.toolCall.function),
          done: false
        }

        // now execute
        const args = JSON.parse(this.toolCall.args)
        logger.log(`[anthropic] tool call ${this.toolCall.function} with ${JSON.stringify(args)}`)
        const content = await this.callTool(this.toolCall.function, args)
        logger.log(`[anthropic] tool call ${this.toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

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
          name: this.toolCall.function,
          done: true,
          call: {
            params: args,
            result: content
          },
        }

        // switch to new stream
        yield {
          type: 'stream',
          stream: await this.doStream(),
        }

      }

    }

  }

  addAttachmentToPayload(message: Message, payload: LLmCompletionPayload) {
    payload.content = [
      { type: 'text', text: message.contentForModel },
      { type: 'image', source: {
        type: 'base64',
        media_type: message.attachment!.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: message.attachment!.content,
      }}
    ]
  }

  buildPayload(model: string, thread: Message[]): LLmCompletionPayload[] {
    const payload: LLmCompletionPayload[] = super.buildPayload(model, thread)
    return payload.filter((payload) => payload.role != 'system').map((payload): LLmCompletionPayload => {
      //if (payload.role == 'system') return null
      if (typeof payload.content == 'string') {
        return {
          role: payload.role as 'user'|'assistant',
          content: payload.content
        }
      } else {
        return {
          role: payload.role as 'user'|'assistant',
          content: payload.content!.map((content: LlmContentPayload): TextBlockParam|ImageBlockParam => {
            if (content.type == 'image') {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: (content as LLmContentPayloadImageAnthropic).source!.media_type,
                  data: (content as LLmContentPayloadImageAnthropic).source!.data,
                }
              }
            } else {
              return {
                type: 'text',
                text: (content as LLmContentPayloadText).text
              }
            }
          })
        }
      }
    })
  }

}
