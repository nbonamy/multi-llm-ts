import { EngineCreateOpts, Model } from 'types/index'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall, LLmCompletionPayload, LlmStreamingResponse } from 'types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextBase } from '../engine'
import { Plugin } from '../plugin'
import logger from '../logger'

import Anthropic from '@anthropic-ai/sdk'
import { Stream } from '@anthropic-ai/sdk/streaming'
import { Tool, MessageParam, MessageStreamEvent, TextBlock, InputJSONDelta, Usage, RawMessageStartEvent, RawMessageDeltaEvent, MessageDeltaUsage, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion, MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/beta/messages/messages'

//
// https://docs.anthropic.com/en/api/getting-started
//

type AnthropicTool = Tool|BetaToolUnion

export interface AnthropicComputerToolInfo {
  plugin: Plugin
  screenSize(): { width: number, height: number }
  screenNumber (): number
}

export type AnthropicStreamingContext = LlmStreamingContextBase & {
  system: string,
  usage: Usage,
  toolCall?: LlmToolCall,
  thinkingBlock?: string,
  thinkingSignature?: string,
}

export default class extends LlmEngine {

  client: Anthropic
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
      'claude-3-5-sonnet-*',
      'claude-3-sonnet-*',
      'claude-3-opus-*',
      'claude-3-haiku-*'
    ]
  }

  getComputerUseRealModel(): string {
    return 'claude-3-5-sonnet-20241022'
  }

  modelIsReasoning(model: string): boolean {
    // Support both the specific test model and any Claude 3.7 model
    return model === 'claude-3-7-sonnet-thinking' || 
           model.includes('claude-3-7') ||
           model.includes('claude-3.7');
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    const models = await this.client.models.list({ limit: 1000 })

    // transform
    return [
      ...models.data.map((model) => ({
        id: model.id,
        name: model.display_name,
        meta: model
      })),
      ...(this.computerInfo ? [{ id: 'computer-use', name: 'Computer Use' }] : [])
    ]

  }

  getMaxTokens(model: string): number {
    if (model.includes('claude-3-5-sonnet') || model.includes('computer-use')) return 8192
    else return 4096
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    return await this.chat(model, [
      thread[0],
      ...this.buildPayload(model, thread, opts)
    ], opts)
  }

  async chat(model: string, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // model
    if (model === 'computer-use') {
      model = this.getComputerUseRealModel()
    }

    // call
    logger.log(`[anthropic] prompting model ${model}`)
    const response = await this.client.messages.create({
      model: model,
      system: thread[0].contentForModel,
      messages: thread.slice(1) as MessageParam[],
      ...this.getCompletionOpts(model, opts),
      ...await this.getToolOpts(model, opts),
    });

    // tool call
    if (response.stop_reason === 'tool_use') {

      const toolCall = response.content[response.content.length - 1] as ToolUseBlock
      
      // need
      logger.log(`[anthropic] tool call ${toolCall.name} with ${JSON.stringify(toolCall.input)}`)

      // now execute
      const content = await this.callTool(toolCall.name, toolCall.input)
      logger.log(`[anthropic] tool call ${toolCall.name} => ${JSON.stringify(content).substring(0, 128)}`)

      // add all response blocks
      thread.push(...response.content.map((c) => ({
        role: 'assistant',
        content: [c]
      })))

      // add tool response message
      if (toolCall!.name === 'computer') {
        thread.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolCall.id,
            ...content,
          }]
        })
      } else {
        thread.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify(content)
          }]
        })
      }

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // cumulate usage
      if (opts?.usage && response.usage && completion.usage) {
        completion.usage.prompt_tokens += response.usage.input_tokens
        completion.usage.completion_tokens += response.usage.output_tokens
      }

      // done
      return completion

    }

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

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // add computer tools
    if (this.computerInfo && model === 'computer-use') {
      const computerUse = this.plugins.find((p) => p.getName() === this.computerInfo!.plugin.getName())
      if (!computerUse) {
        this.plugins.push(this.computerInfo.plugin)
      }
    }

    // the context
    const context: AnthropicStreamingContext = {
      model: model,
      system: thread[0].contentForModel,
      thread: this.buildPayload(model, thread, opts) as MessageParam[],
      opts: opts || {},
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context,
    }

  }

  async doStream(context: AnthropicStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCall = undefined
    context.thinkingBlock = undefined
    context.thinkingSignature = ''

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
    if (this.computerInfo && context.model === 'computer-use') {
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
    if (context.model === 'computer-use') {
      return this.doStreamBeta(context)
    } else {
      return this.doStreamNormal(context)
    }

  }

  async doStreamNormal(context: AnthropicStreamingContext): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${context.model}`)
    return this.client.messages.create({
      model: context.model,
      system: context.system,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts(context.model, context.opts),
      stream: true,
    })
  }

  async doStreamBeta(context: AnthropicStreamingContext): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${context.model}`)
    return this.client.beta.messages.create({
      model: this.getComputerUseRealModel(),
      betas: [ 'computer-use-2024-10-22' ],
      system: context.system,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts(context.model, context.opts),
      stream: true,
    })
  }

  getCompletionOpts(model: string, opts?: LlmCompletionOpts): Omit<MessageCreateParamsBase, 'model'|'messages'|'stream'|'tools'|'tool_choice'> {
    const isThinkingEnabled = this.modelIsReasoning(model) && opts?.reasoning;
    
    return {
      max_tokens: opts?.maxTokens ?? this.getMaxTokens(model),
      ...(isThinkingEnabled ? { temperature: 1.0 } : (opts?.temperature ? { temperature: opts?.temperature } : {})),
      ...(opts?.top_k ? { top_k: opts?.top_k } : {} ),
      ...(opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(isThinkingEnabled ? {
        thinking: {
          type: 'enabled',
          budget_tokens: opts.reasoningBudget || (opts?.maxTokens || this.getMaxTokens(model)) / 2,
        }
      } : {}),
    }
  }

  async getToolOpts<T>(model: string, opts?: LlmCompletionOpts): Promise<Omit<T, 'max_tokens'|'model'|'messages'|'stream'>> {

    if (opts?.tools === false) {
      return {} as T
    }

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

    return tools.length ? {
      tool_choice: { type: 'auto' },
      tools: tools as Tool[]
    } as T : {} as T 
  }
  
  async stop(stream: Stream<any>) {
    stream.controller.abort()
  }
   
  async *nativeChunkToLlmChunk(chunk: MessageStreamEvent, context: AnthropicStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    
    // log
    //console.dir(chunk, { depth: null })

    // usage
    const usage: Usage|MessageDeltaUsage = (chunk as RawMessageStartEvent).message?.usage ?? (chunk as RawMessageDeltaEvent).usage
    if (context.usage && usage) {
      if ('input_tokens' in usage) {
        context.usage.input_tokens += (usage as Usage).input_tokens ?? 0
      }
      context.usage.output_tokens += usage.output_tokens ?? 0
    }

    // done
    if (chunk.type == 'message_stop') {
      yield { type: 'content', text: '', done: true }
      if (context.usage && context.opts.usage) {
        yield { type: 'usage', usage: {
          prompt_tokens: context.usage.input_tokens,
          completion_tokens: context.usage.output_tokens,
        }}
      }
    }

    // block start
    if (chunk.type == 'content_block_start') {

      if (chunk.content_block.type == 'thinking') {
        context.thinkingBlock = ''
      }

      if (chunk.content_block.type == 'tool_use') {

        // record the tool call
        context.toolCall = {
          id: chunk.content_block.id,
          message: '',
          function: chunk.content_block.name,
          args: ''
        }

        // notify
        yield {
          type: 'tool',
          name: context.toolCall.function,
          status: this.getToolPreparationDescription(context.toolCall.function),
          done: false
        }
        
      } else {
        context.toolCall = undefined
      }
    }

    // block delta
    if (chunk.type == 'content_block_delta') {

      // tool use
      if (context.toolCall !== undefined) {
        const toolDelta = chunk.delta as InputJSONDelta
        context.toolCall!.args += toolDelta.partial_json
      }

      // thinking
      if (context.toolCall === undefined && chunk.delta.type === 'thinking_delta') {
        context.thinkingBlock += chunk.delta.thinking
        yield { type: 'reasoning', text: chunk.delta.thinking, done: false }
      }

      // thinking signature
      if (context.toolCall === undefined && chunk.delta.type === 'signature_delta') {
        context.thinkingSignature = chunk.delta.signature
      }
      
      // text
      if (context.toolCall === undefined && chunk.delta.type === 'text_delta') {
        yield { type: 'content', text: chunk.delta.text, done: false }
      }

    }

    // tool call?
    if (chunk.type == 'message_delta') {
      if (chunk.delta.stop_reason == 'tool_use' && context.toolCall !== undefined) {

        // need
        logger.log(`[anthropic] tool call ${context.toolCall!.function} with ${context.toolCall!.args}`)
        const args = JSON.parse(context.toolCall!.args)

        // first notify
        yield {
          type: 'tool',
          name: context.toolCall!.function,
          status: this.getToolRunningDescription(context.toolCall!.function, args),
          done: false
        }

        // now execute
        const content = await this.callTool(context.toolCall!.function, args)
        logger.log(`[anthropic] tool call ${context.toolCall!.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add thinking block
        if (context.thinkingBlock) {
          context.thread.push({
            role: 'assistant',
            content: [{
              type: 'thinking',
              thinking: context.thinkingBlock,
              signature: context.thinkingSignature
            }]
          })
        }

        // add tool call message
        context.thread.push({
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: context.toolCall!.id,
            name: context.toolCall!.function,
            input: args,
          }]
        })

        // add tool response message
        if (context.toolCall!.function === 'computer') {
          context.thread.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: context.toolCall!.id,
              ...content,
            }]
          })
        } else {
          context.thread.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: context.toolCall!.id,
              content: JSON.stringify(content)
            }]
          })
        }

        // clear
        yield {
          type: 'tool',
          name: context.toolCall!.function,
          done: true,
          call: {
            params: args,
            result: content
          },
        }

        // switch to new stream
        yield {
          type: 'stream',
          stream: await this.doStream(context),
        }

      }

    }

  }

  addTextToPayload(message: Message, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {
    payload.content = [
      { type: 'text', text: message.contentForModel },
      {
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: message.attachment!.content,
        },
        ...(message.attachment!.title.length ? { title: message.attachment!.title } : {}),
        ...(message.attachment!.context.length ? { context: message.attachment!.context } : {}),
        ...(opts ? { citations: { enabled: opts?.citations ?? false } } : {})
      }
    ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(message: Message, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {
    payload.content = [
      { type: 'text', text: message.contentForModel },
      { type: 'image', source: {
        type: 'base64',
        media_type: message.attachment!.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: message.attachment!.content,
      }}
    ]
  }

  buildPayload(model: string, thread: Message[], opts?: LlmCompletionOpts): LLmCompletionPayload[] {
    const payload: LLmCompletionPayload[] = super.buildPayload(model, thread, opts)
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
          content: payload.content/*!.map((content: LlmContentPayload): TextBlockParam|ImageBlockParam => {
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
          })*/
        }
      }
    })
  }

}
