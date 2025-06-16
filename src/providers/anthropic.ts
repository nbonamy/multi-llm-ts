import { ChatModel, EngineCreateOpts, ModelAnthropic, ModelCapabilities } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall, LLmCompletionPayload, LlmStreamingResponse, LlmToolCallInfo } from '../types/llm'
import { minimatch } from 'minimatch'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextBase } from '../engine'
import { Plugin } from '../plugin'
import logger from '../logger'

import Anthropic from '@anthropic-ai/sdk'
import { Tool, MessageParam, MessageStreamEvent, TextBlock, InputJSONDelta, Usage, RawMessageStartEvent, RawMessageDeltaEvent, MessageDeltaUsage, ToolUseBlock } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion, MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import Attachment from 'models/attachment'

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
  toolCall?: LlmToolCall,
  thinkingBlock?: string,
  thinkingSignature?: string,
  firstTextBlockStart: boolean,
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

  getId(): string {
    return 'anthropic'
  }

  // https://docs.anthropic.com/en/docs/about-claude/models

  getModelCapabilities(model: ModelAnthropic): ModelCapabilities {

    const visionGlobs = [
      'claude-3-*',
      'claude-*-4-*',
      'computer-use',
    ]

    const reasoning = model.id === 'claude-3-7-sonnet-thinking' || 
      model.id.includes('claude-3-7') ||
      model.id.includes('claude-3.7') || 
      minimatch(model.id, 'claude-*-4-*');
    
    return {
      tools: true,
      vision: visionGlobs.some((m) => minimatch(model.id, m)),
      reasoning,
      responses: false
    }

  }
  
  getComputerUseRealModel(): string {
    return 'claude-3-5-sonnet-20241022'
  }

  getMaxTokens(model: string): number {
    if (model === 'computer-use') return this.getMaxTokens(this.getComputerUseRealModel())
    if (model.includes('claude-opus-4')) return 32000
    if (model.includes('claude-sonnet-4')) return 64000
    if (model.includes('claude-3-7-')) return 64000
    if (model.includes('claude-3-5-')) return 8192
    else return 4096
  }

  async getModels(): Promise<ModelAnthropic[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    const models = await this.client.models.list({ limit: 1000 })

    // transform
    return [
      ...models.data,
      ...(this.computerInfo ? [{
        'type': 'model',  id: 'computer-use', display_name: 'Computer Use', created_at: '1970-01-01T00:00:00Z'
      }] : [])
    ]

  }

  async complete(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    return await this.chat(model, [
      thread[0],
      ...this.buildPayload(model, thread, opts)
    ], opts)
  }

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // model
    if (model.id === 'computer-use') {
      model = this.toModel(this.getComputerUseRealModel())
    }

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[anthropic] prompting model ${model.id}`)
    const response = await this.client.messages.create({
      model: model.id,
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
      const content = await this.callTool({ model: model.id }, toolCall.name, toolCall.input)
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

      // save tool call info
      toolCallInfo.push({
        name: toolCall.name,
        params: toolCall.input,
        result: content
      })

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // prepend tool call info
      completion.toolCalls = [
        ...toolCallInfo,
        ...completion.toolCalls ?? [],
      ]

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
      toolCalls: toolCallInfo,
      ...(opts?.usage && response.usage ? { usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
      } } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // add computer tools
    if (this.computerInfo && model.id === 'computer-use') {
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
      usage: this.zeroUsage(),
      firstTextBlockStart: true
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
    if (this.computerInfo && context.model.id === 'computer-use') {
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
    if (context.model.id === 'computer-use') {
      return this.doStreamBeta(context)
    } else {
      return this.doStreamNormal(context)
    }

  }

  async doStreamNormal(context: AnthropicStreamingContext): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${context.model.id}`)
    return this.client.messages.create({
      model: context.model.id,
      system: context.system,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts(context.model, context.opts),
      stream: true,
    })
  }

  async doStreamBeta(context: AnthropicStreamingContext): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${context.model.id}`)
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

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<MessageCreateParamsBase, 'model'|'messages'|'stream'|'tools'|'tool_choice'> {

    const isThinkingEnabled = model.capabilities?.reasoning && opts?.reasoning;
    
    return {
      max_tokens: opts?.maxTokens ?? this.getMaxTokens(model.id),
      ...(opts?.temperature ? { temperature: opts.temperature } : (isThinkingEnabled ? { temperature: 1.0 } : {})),
      ...(opts?.top_k ? { top_k: opts?.top_k } : {} ),
      ...(opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(isThinkingEnabled ? {
        thinking: {
          type: 'enabled',
          budget_tokens: opts.reasoningBudget || (opts?.maxTokens || this.getMaxTokens(model.id)) / 2,
        }
      } : {}),
    }
  }

  async getToolOpts<T>(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<T, 'max_tokens'|'model'|'messages'|'stream'>> {

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
  
  async stop(stream: LlmStream): Promise<void> {
    stream.controller?.abort()
  }
   
  async *nativeChunkToLlmChunk(chunk: MessageStreamEvent, context: AnthropicStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    
    // log
    //console.dir(chunk, { depth: null })

    // usage
    const usage: Usage|MessageDeltaUsage = (chunk as RawMessageStartEvent).message?.usage ?? (chunk as RawMessageDeltaEvent).usage
    if (context.usage && usage) {
      if ('input_tokens' in usage) {
        context.usage.prompt_tokens += (usage as Usage).input_tokens ?? 0
      }
      context.usage.completion_tokens += usage.output_tokens ?? 0
    }

    // done
    if (chunk.type == 'message_stop') {
      yield { type: 'content', text: '', done: true }
      if (context.opts.usage) {
        yield { type: 'usage', usage: context.usage }
      }
    }

    // block start
    if (chunk.type == 'content_block_start') {

      if (chunk.content_block.type == 'text') {
        if (!context.firstTextBlockStart) {
          yield { type: 'content', text: '\n\n', done: false }
        }
        context.firstTextBlockStart = false
      }

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
          id: context.toolCall.id,
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

      // citation
      if (context.toolCall === undefined && chunk.delta.type === 'citations_delta') {
        yield { type: 'content', text: chunk.delta.citation.cited_text, done: false }
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
        const args = context.toolCall!.args?.length ? JSON.parse(context.toolCall!.args) : {}

        // first notify
        yield {
          type: 'tool',
          id: context.toolCall.id,
          name: context.toolCall!.function,
          status: this.getToolRunningDescription(context.toolCall!.function, args),
          call: {
            params: args,
            result: undefined
          },
          done: false
        }

        // now execute
        const content = await this.callTool({ model: context.model.id }, context.toolCall!.function, args)
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
          id: context.toolCall.id,
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

  addTextToPayload(message: Message, attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {
    if (Array.isArray(payload.content)) {
      payload.content.push({
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',
          data: attachment!.content,
        },
        ...(attachment!.title.length ? { title: attachment!.title } : {}),
        ...(attachment!.context.length ? { context: attachment!.context } : {}),
        ...(opts ? { citations: { enabled: opts?.citations ?? false } } : {})
      })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {
    if (Array.isArray(payload.content)) {
      payload.content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment!.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: attachment!.content,
        }
      })
    }
  }

  buildPayload(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): LLmCompletionPayload[] {
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
