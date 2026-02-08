import Anthropic from '@anthropic-ai/sdk'
import { ContentBlockParam, InputJSONDelta, MessageCreateParams, MessageDeltaUsage, MessageParam, RawMessageDeltaEvent, RawMessageStartEvent, RawMessageStreamEvent, TextBlock, Tool, ToolChoice, ToolUseBlock, Usage } from '@anthropic-ai/sdk/resources'
import { BetaToolUnion, MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { minimatch } from 'minimatch'
import LlmEngine from '../engine'
import logger from '../logger'
import Attachment from '../models/attachment'
import Message from '../models/message'
import { Plugin } from '../plugin'
import { ChatModel, EngineCreateOpts, ModelAnthropic, ModelCapabilities } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LlmCompletionPayload, LlmResponse, LlmStream, LlmStreamingContext, LlmStreamingResponse, LlmToolCallInfo, LlmUsage } from '../types/llm'
import { addUsages, zeroUsage } from '../usage'
import { PluginExecutionResult, PluginParameter } from '../types/plugin'

//
// https://docs.anthropic.com/en/api/getting-started
//

type AnthropicTool = Tool|BetaToolUnion

export type AnthropicCompletionOpts = LlmCompletionOpts & {
  system?: string
}

const kAnthropicCachedItems = 4

export interface AnthropicComputerToolInfo {
  plugin: Plugin
  screenSize(): { width: number, height: number }
  screenNumber (): number
}

export type AnthropicStreamingContext = LlmStreamingContext<MessageParam> & {
  system: string
  requestUsage: LlmUsage
  thinkingBlock?: string
  thinkingSignature?: string
  textContentBlock?: string
  firstTextBlockStart: boolean
}

export default class extends LlmEngine {

  client: Anthropic
  computerInfo: AnthropicComputerToolInfo|null = null

 constructor(config: EngineCreateOpts, computerInfo: AnthropicComputerToolInfo|null = null) {
    super(config)
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      dangerouslyAllowBrowser: true,
    })
    this.computerInfo = computerInfo
  }

  // Convert PluginParameter[] to Anthropic input_schema format
  private toolDefinitionToInputSchema(parameters: PluginParameter[]): Tool['input_schema'] {
    const properties: Record<string, any> = {}
    const required: string[] = []

    for (const param of parameters) {
      const type = param.type || (param.items ? 'array' : 'string')
      const prop: any = {
        type,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      }
      if (type === 'array') {
        prop.items = this.convertItems(param.items)
      }
      properties[param.name] = prop
      if (param.required) {
        required.push(param.name)
      }
    }

    return {
      type: 'object',
      properties,
      required,
    }
  }

  private convertItems(items: PluginParameter['items']): any {
    if (!items) return { type: 'string' }
    if (!items.properties) {
      return { type: items.type }
    }
    const props: Record<string, any> = {}
    const required: string[] = []
    for (const prop of items.properties) {
      props[prop.name] = {
        type: prop.type,
        description: prop.description,
      }
      if (prop.required) {
        required.push(prop.name)
      }
    }
    return {
      type: items.type || 'object',
      properties: props,
      required,
    }
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
      minimatch(model.id, 'claude-*-4-*')

    const cachingGlobs = [
      'claude-opus-4-*',
      'claude-sonnet-4-*',
      'claude-3-7-sonnet-*',
      'claude-3-5-sonnet-*',
      'claude-3-5-haiku-*',
      'claude-3-opus-*',
      'claude-3-haiku-*',
    ]

    return {
      tools: true,
      vision: visionGlobs.some((m) => minimatch(model.id, m)),
      reasoning,
      caching: cachingGlobs.some((m) => minimatch(model.id, m)),
    }

  }
  
  getComputerUseRealModel(): string {
    return 'claude-3-5-sonnet-20241022'
  }

  isComputerUseModel(model: string): boolean {
    return ['computer-use'].includes(model)
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
      ...models.data, {
        'type': 'model',  id: 'computer-use', display_name: 'Computer Use', created_at: '1970-01-01T00:00:00Z'
      }
    ]

  }

  async complete(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    return await this.chat(model, this.buildAnthropicPayload(model, thread, opts), {
      ...opts,
      system: thread[0].contentForModel
    })
  }

  async chat(model: ChatModel, thread: MessageParam[], opts?: AnthropicCompletionOpts): Promise<LlmResponse> {

    // model
    if (model.id === 'computer-use') {
      model = this.toModel(this.getComputerUseRealModel())
    }

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    const startTime = Date.now()

    // call
    logger.log(`[anthropic] prompting model ${model.id}`)
    const response = await this.client.messages.create(this.cacheRequest(model, opts ?? {}, {
      model: model.id,
      system: opts?.system,
      messages: thread,
      ...this.getCompletionOpts(model, opts),
      ...await this.getToolOpts(model, opts),
    }));

    // tool call
    if (response.stop_reason === 'tool_use') {

      const toolCall = response.content[response.content.length - 1] as ToolUseBlock
      
      // need
      logger.log(`[anthropic] tool call ${toolCall.name} with ${JSON.stringify(toolCall.input)}`)

        // now execute
        let lastUpdate: PluginExecutionResult|undefined = undefined
        for await (const update of this.callTool(
          { model: model.id, abortSignal: opts?.abortSignal },
          toolCall.name, toolCall.input,
          opts?.toolExecutionValidation
        )) {
          if (update.type === 'result') {
            lastUpdate = update
          }
        }

        // process result
        const { content, canceled: toolCallCanceled } = this.processToolExecutionResult(
          'anthropic',
          toolCall.name,
          toolCall.input,
          lastUpdate
        )

        // For non-streaming, throw immediately on cancel
        if (toolCallCanceled) {
          throw new Error('Tool execution was canceled')
        }

      // add all response blocks
      thread.push(...response.content.map((c) => ({
        role: 'assistant' as const,
        content: [c]
      })))

      // add tool response message
      if (toolCall!.name === 'computer') {
        thread.push({
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: toolCall.id,
            ...content,
          }]
        })
      } else {
        thread.push({
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
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

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse<AnthropicStreamingContext>> {

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
      thread: this.buildAnthropicPayload(model, thread, opts),
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      startTime: 0,
      opts: opts || {},
      usage: zeroUsage(),
      requestUsage: zeroUsage(),
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
    context.toolCalls = []
    context.startTime = Date.now()
    context.requestUsage = zeroUsage()
    context.thinkingBlock = undefined
    context.thinkingSignature = ''
    context.textContentBlock = undefined

    // tools in anthropic format
    const tools: AnthropicTool[] = (await this.getAvailableTools()).map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: this.toolDefinitionToInputSchema(tool.parameters),
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
    return this.client.messages.create(this.cacheRequest(context.model, context.opts, {
      model: context.model.id,
      system: context.system,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts<MessageCreateParams>(context.model, context.opts),
      stream: true,
    }))
  }

  async doStreamBeta(context: AnthropicStreamingContext): Promise<LlmStream> {
    logger.log(`[anthropic] prompting model ${context.model.id}`)
    return this.client.beta.messages.create(this.cacheRequest(context.model, context.opts, {
      model: this.getComputerUseRealModel(),
      betas: [ 'computer-use-2024-10-22' ],
      system: context.system,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts<MessageCreateParams>(context.model, context.opts),
      stream: true,
    }))
  }

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<MessageCreateParamsBase, 'model'|'messages'|'stream'|'tools'|'tool_choice'> {

    const isThinkingEnabled = model.capabilities?.reasoning && opts?.reasoning !== false;
    
    return {
      max_tokens: opts?.maxTokens ?? this.getMaxTokens(model.id),
      ...(opts?.temperature ? { temperature: opts.temperature } : (isThinkingEnabled ? { temperature: 1.0 } : {})),
      ...(opts?.top_k ? { top_k: opts?.top_k } : {} ),
      ...(opts?.top_p ? { top_p: opts?.top_p } : {} ),
      ...(isThinkingEnabled ? {
        thinking: {
          type: 'enabled',
          budget_tokens: opts?.reasoningBudget || 1024,
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
        name: tool.name,
        description: tool.description,
        input_schema: this.toolDefinitionToInputSchema(tool.parameters),
      }
    })

    let toolChoice: ToolChoice = { type: 'auto' }
    if (opts?.toolChoice?.type === 'auto' || opts?.toolChoice?.type === 'none') {
      toolChoice = opts.toolChoice
    } else if (opts?.toolChoice?.type === 'required') {
      toolChoice = { type: 'any' }
    } else if (opts?.toolChoice?.type === 'tool') {
      toolChoice = { type: 'tool', name: opts.toolChoice.name }
    }

    // done
    return tools.length ? {
      tool_choice: toolChoice,
      tools: tools as Tool[]
    } as T : {} as T 
  }

  cacheRequest<T extends MessageCreateParamsBase>(model: ChatModel, opts: LlmCompletionOpts, params: T): T {

    // no caching
    if (!opts.caching) {
      return params
    }

    // not all models support caching
    if (!model.capabilities.caching) {
      return params
    }

    // calculate length of description of tool and each properties for each tool
    const itemsSizes: { name: string, size: number }[] = []
    for (const tool of params.tools as Tool[] || []) {
      if (!('description' in tool)) continue
      const descriptionLength = tool.description ? tool.description.length : 0
      const propertiesLength = 'input_schema' in tool ? Object.values(tool.input_schema.properties || {}).reduce((propAcc, prop) => {
        return propAcc + (prop.description ? prop.description.length : 0)
      }, 0) : 0
      if (descriptionLength + propertiesLength === 0) continue
      itemsSizes.push({ name: tool.name, size: descriptionLength + propertiesLength })
    }

    // add system prompt
    const systemPromptName = '__system__prompt__'
    if (typeof params.system === 'string') {
      itemsSizes.push({ name: systemPromptName, size: params.system.length })
    }

    const sortedItems = itemsSizes.sort((a, b) => b.size - a.size).slice(0, kAnthropicCachedItems).map(tool => tool.name)
    for (const item of sortedItems) {
      if (item === systemPromptName) {
        params.system = [{
          type: 'text',
          text: params.system as string,
          cache_control: { type: 'ephemeral',  }
        }]

      } else {
        const tool = params.tools?.find((t: any) => t.name === item)
        if (tool) {
          tool.cache_control = { type: 'ephemeral', }
        }
      }
    }

    // done
    return params

  }

  async stop(stream: LlmStream): Promise<void> {
    stream.controller?.abort()
  }

  syncToolHistoryToThread(context: AnthropicStreamingContext): void {
    // sync mutations from toolHistory back to thread
    // Anthropic thread format: { role: 'user', content: [{ type: 'tool_result', tool_use_id, content }] }
    for (const entry of context.toolHistory) {
      for (const msg of context.thread) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (typeof block === 'object' && 'type' in block && block.type === 'tool_result' && 'tool_use_id' in block && block.tool_use_id === entry.id) {
              (block as any).content = JSON.stringify(entry.result)
            }
          }
        }
      }
    }
  }

  async *processNativeChunk(chunk: RawMessageStreamEvent, context: AnthropicStreamingContext): AsyncGenerator<LlmChunk> {
    
    // log
    //console.dir(chunk, { depth: null })

    // usage
    const usage: Usage|MessageDeltaUsage = (chunk as RawMessageStartEvent).message?.usage ?? (chunk as RawMessageDeltaEvent).usage
    if (context.usage && usage) {
      if ('input_tokens' in usage) {
        context.requestUsage.prompt_tokens = (usage as Usage).input_tokens ?? 0
      }
      if ('cache_read_input_tokens' in usage && context.requestUsage.prompt_tokens_details?.cached_tokens !== undefined) {
        context.requestUsage.prompt_tokens_details.cached_tokens = (usage as Usage).cache_read_input_tokens ?? 0
      }
      context.requestUsage.completion_tokens = usage.output_tokens ?? 0
    }

    // done
    if (chunk.type == 'message_stop') {
      yield { type: 'content', text: '', done: true }
      if (context.opts.usage) {
        context.usage = addUsages(context.usage, context.requestUsage)
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
        // New tool call - normalize as 'start'
        yield* this.processToolCallChunk({
          type: 'start',
          id: chunk.content_block.id,
          name: chunk.content_block.name,
          args: '',
        }, context)
      }
    }

    // block delta
    if (chunk.type == 'content_block_delta') {

      // tool use - normalize as 'delta'
      if (chunk.delta.type === 'input_json_delta' && context.toolCalls.length) {
        const toolDelta = chunk.delta as InputJSONDelta
        yield* this.processToolCallChunk({
          type: 'delta',
          argumentsDelta: toolDelta.partial_json,
        }, context)
      }

      // thinking
      if (chunk.delta.type === 'thinking_delta') {
        context.thinkingBlock += chunk.delta.thinking
        yield { type: 'reasoning', text: chunk.delta.thinking, done: false }
      }

      // thinking signature
      if (chunk.delta.type === 'signature_delta') {
        context.thinkingSignature = chunk.delta.signature
      }

      // citation
      if (chunk.delta.type === 'citations_delta') {
        yield { type: 'content', text: chunk.delta.citation.cited_text, done: false }
      }

      // text
      if (chunk.delta.type === 'text_delta') {
        context.textContentBlock = (context.textContentBlock || '') + chunk.delta.text
        yield { type: 'content', text: chunk.delta.text, done: false }
      }

    }

    // tool call?
    if (chunk.type == 'message_delta') {

      if (chunk.delta.stop_reason == 'tool_use' && context.toolCalls.length) {

        // clear force tool call to avoid infinite loop
        if (context.opts.toolChoice?.type === 'tool') {
          delete context.opts.toolChoice
        }

        // increment round for next iteration
        context.currentRound++

        // add usage before continuing
        if (context.opts.usage) {
          context.usage = addUsages(context.usage, context.requestUsage)
          context.requestUsage = zeroUsage()
        }

        // execute tool calls using base class method
        yield* this.executeToolCallsBatched(context.toolCalls, context, {
          formatBatchForThread: (completed) => {
            // build assistant content: thinking + text + tool uses
            const assistantContent: ContentBlockParam[] = []

            // add thinking block first if present
            if (context.thinkingBlock) {
              assistantContent.push({
                type: 'thinking',
                thinking: context.thinkingBlock,
                signature: context.thinkingSignature || ''
              })
            }

            // add accumulated text content if present
            if (context.textContentBlock) {
              assistantContent.push({
                type: 'text',
                text: context.textContentBlock
              })
            }

            // add tool uses
            for (const { tc, args } of completed) {
              assistantContent.push({
                type: 'tool_use' as const,
                id: tc.id,
                name: tc.function,
                input: args,
              })
            }

            // assistant message with all content
            const toolUses: MessageParam = {
              role: 'assistant',
              content: assistantContent
            }

            // user message with all tool results
            const toolResults: MessageParam = {
              role: 'user',
              content: completed.map(({ tc, result }) => {
                // computer tool spreads content, others stringify
                if (tc.function === 'computer') {
                  return {
                    type: 'tool_result' as const,
                    tool_use_id: tc.id,
                    ...result,
                  }
                }
                return {
                  type: 'tool_result' as const,
                  tool_use_id: tc.id,
                  content: JSON.stringify(result)
                }
              })
            }

            return [toolUses, toolResults]
          },
          createNewStream: async () => this.doStream(context)
        })

        // done
        return

      }

    }

  }

  addTextToPayload(model: ChatModel, message: Message, attachment: Attachment, payload: LlmCompletionPayload, opts?: LlmCompletionOpts): void {
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
  addImageToPayload(model: ChatModel, attachment: Attachment, payload: LlmCompletionPayload, opts?: LlmCompletionOpts) {
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

  buildAnthropicPayload(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): MessageParam[] {

    const payload = this.buildPayload(model, thread, opts)

    return payload.filter((p) => p.role != 'system').reduce((arr: MessageParam[], item: any) => {

      if (item.role === 'assistant' && item.tool_calls) {

        const message: MessageParam = {
          role: 'assistant' as const,
          content: [] as ContentBlockParam[]
        }

        for (const tc of item.tool_calls) {

          let input = tc.function.arguments
          try {
            input = JSON.parse(tc.function.arguments)
          } catch {
            // ignore
          }

          (message.content as any[]).push({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.function.name,
            input: input || {},
          })

        }

        arr.push(message)

      }

      if (item.role === 'tool') {

        const content = {
          type: 'tool_result' as const,
          tool_use_id: item.tool_call_id,
          content: item.content
        }

        // append to previous user message if possible
        if (arr.length > 2 && arr[arr.length - 2]?.role === 'user' && Array.isArray(arr[arr.length - 2].content) && (arr[arr.length - 2].content as any[]).every((c: any) => c.type === 'tool_result') ) {

          (arr[arr.length - 2].content as any[]).push(content)

        } else {

          const message: MessageParam = {
            role: 'user' as const,
            content: [ content ]
          }

          const index = arr.findLastIndex((m) => m.role === 'assistant')
          if (index === -1) {
            arr.push(message)
          } else {
            arr.splice(index, 0, message)
          }

        }

        return arr
      }
      
      if (typeof item.content == 'string') {
        arr.push({
          role: item.role as 'user'|'assistant',
          content: item.content
        })
      } else {
        arr.push({
          role: item.role as 'user'|'assistant',
          content: item.content as ContentBlockParam[]
        })
      }

      // done
      return arr

    }, [])
  }

}
