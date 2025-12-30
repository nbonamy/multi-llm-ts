/* eslint-disable @typescript-eslint/no-unused-vars */

import { ChatModel, EngineCreateOpts, Model, ModelCapabilities, ModelMetadata, ModelsList } from './types/index'
import { LlmResponse, LlmCompletionOpts, LLmCompletionPayload, LlmCompletionPayloadContent, LlmCompletionPayloadTool, LlmChunk, LlmTool, LlmToolArrayItem, LlmToolCall, LlmStreamingResponse, LlmStreamingContext, CompletedToolCall, LlmUsage, LlmStream, LlmToolExecutionValidationCallback, LlmToolExecutionValidationResponse, LlmChunkToolAbort, EngineHookName, EngineHookCallback, EngineHookPayloads, NormalizedToolChunk } from './types/llm'
import { IPlugin, PluginExecutionContext, PluginExecutionUpdate, PluginParameter, PluginExecutionResult } from './types/plugin'
import { Plugin, ICustomPlugin, MultiToolPlugin } from './plugin'
import Attachment from './models/attachment'
import Message from './models/message'
import logger from './logger'

export default abstract class LlmEngine {

  config: EngineCreateOpts
  plugins: IPlugin[]
  private hooks: Map<EngineHookName, EngineHookCallback<EngineHookName>[]> = new Map()

  static isConfigured = (opts: EngineCreateOpts): boolean => {
    return (opts?.apiKey != null && opts.apiKey.length > 0)
  }

  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return LlmEngine.isConfigured(opts) && models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    this.config = config
    this.plugins = []
  }

  //
  // Hooks
  //

  addHook<T extends EngineHookName>(name: T, callback: EngineHookCallback<T>): () => void {
    const callbacks = this.hooks.get(name) || []
    callbacks.push(callback as EngineHookCallback<EngineHookName>)
    this.hooks.set(name, callbacks)
    return () => {
      const cbs = this.hooks.get(name) || []
      this.hooks.set(name, cbs.filter(cb => cb !== callback))
    }
  }

  protected async callHook<T extends EngineHookName>(name: T, payload: EngineHookPayloads[T]): Promise<void> {
    const callbacks = this.hooks.get(name) || []
    for (const cb of callbacks) {
      await cb(payload)
    }
  }

  protected abstract syncToolHistoryToThread(context: LlmStreamingContext): void

  abstract getId(): string
  
  getName(): string {
    return this.getId()
  }

  abstract getModelCapabilities(model: ModelMetadata): ModelCapabilities
  
  abstract getModels(): Promise<ModelMetadata[]>
  
  protected abstract chat(model: Model, thread: LLmCompletionPayload[], opts?: LlmCompletionOpts): Promise<LlmResponse>

  protected abstract stream(model: Model, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse>

  /**
   * @deprecated This method is deprecated and may be removed in future versions. Use abortSignal in LlmCompletionOpts instead.
   */
  abstract stop(stream: any): Promise<void>

  protected addTextToPayload(model: ChatModel, message: Message, attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {

    if (Array.isArray(payload.content)) {
      
      // we may need to add to already existing content
      if (this.requiresFlatTextPayload(model, message)) {
        const existingText = payload.content.find((c) => c.type === 'text')
        if (existingText) {
          existingText.text = `${existingText.text}\n\n${attachment.content}`
          return
        }
      }

      // otherwise just add a new text content
      payload.content.push({
        type: 'text',
        text: attachment.content,
      })
    
    } else if (typeof payload.content === 'string') {
      payload.content = `${payload.content}\n\n${attachment.content}`
    }
  }

  protected addImageToPayload(model: ChatModel, attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {

    // if we have a string content, convert it to an array
    if (typeof payload.content === 'string') {
      payload.content = [{
        type: 'text',
        text: payload.content,
      }]
    }

    // now add the image
    if (Array.isArray(payload.content)) {
      payload.content.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.content}` }
      })
    }
  }

  protected abstract nativeChunkToLlmChunk(chunk: any, context: LlmStreamingContext): AsyncGenerator<LlmChunk>

  clearPlugins(): void {
    this.plugins = []
  }

  addPlugin(plugin: Plugin): void {
    this.plugins = this.plugins.filter((p) => p.getName() !== plugin.getName())
    this.plugins.push(plugin)
  }

  async complete(model: ChatModel|string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const chatModel = this.toModel(model)
    const messages = this.buildPayload(chatModel, thread, opts)
    return await this.chat(chatModel, messages, opts)
  }

  async *generate(model: ChatModel|string, thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> {

    // eslint-disable-next-line no-useless-catch
    try {
      
      // init the streaming
      const chatModel = this.toModel(model)
      const response: LlmStreamingResponse = await this.stream(chatModel, thread, opts)
      let currentStream: LlmStream = response.stream

      // now we iterate as when the model emits tool call tokens
      // we execute the tools and start a new stream with the results
      while (true) {

        // out next stream
        let nextStream: LlmStream | null = null

        // iterate the native stream (getting native = user-specific chunks)
        for await (const chunk of currentStream) {

          // Check if abort signal has been triggered
          if (opts?.abortSignal?.aborted) {
            currentStream.controller?.abort(opts?.abortSignal?.reason)
            return
          }

          // now we convert the native chunk to LlmChunks
          // we may have several llm chunks for one native chunk
          const llmChunkStream = this.nativeChunkToLlmChunk(chunk, response.context)

          try {
            for await (const msg of llmChunkStream) {

              // check message type
              if (msg.type === 'stream') {

                // stream switch!
                nextStream = msg.stream

              } else {

                // if we are switching to a new stream make sure we don't send a done message
                // (anthropic sends a 'message_stop' message when finishing current stream for example)
                if (nextStream !== null && msg.type === 'content' && msg.done) {
                  msg.done = false
                }

                // just forward the message
                yield msg

              }

              // Check abort AFTER yielding (so canceled tool chunks go through)
              if (opts?.abortSignal?.aborted) {
                currentStream.controller?.abort(opts?.abortSignal?.reason)
                return
              }

            }
          } catch (error: any) {
            if (error.type === 'tool_abort') {
              yield error as LlmChunkToolAbort
            } else {
              throw error  // Re-throw non-tool-abort errors
            }
          }

        }

        // if no new stream we are done
        // else make the next stream the current one
        if (!nextStream) break
        currentStream = nextStream

      }

    } catch (error) {
      // Re-throw the error to ensure it propagates to the caller
      // This is critical for async generators - errors need explicit handling
      throw error
    }

  }

  protected requiresVisionModelSwitch(thread: Message[], currentModel: ChatModel): boolean {
    
    // if we already have a vision
    if (currentModel.capabilities.vision) {
      return false
    }

    // check if amy of the messages in the thread have an attachment
    return thread.some((msg) => msg.attachments.some(a => a.isImage()))

  }

  protected selectModel(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): ChatModel {

    // init
    if (!opts) {
      return model
    }

    // if we need to switch to vision
    if (this.requiresVisionModelSwitch(thread, model)) {

      // check
      if (!opts.visionFallbackModel) {
        console.debug('Cannot switch to vision model as no models provided in LlmCompletionOpts')
        return model
      }

      // return the fallback model
      return opts.visionFallbackModel

    }

    // no need to switch
    return model

  }

  requiresFlatTextPayload(model: ChatModel, msg: Message) {
    return ['system', 'assistant'].includes(msg.role)
  }

  requiresReasoningContent(): boolean {
    // for deekseek
    return false
  }

  buildPayload<T = LLmCompletionPayload>(model: ChatModel, thread: Message[] | string, opts?: LlmCompletionOpts): T[] {

    if (typeof thread === 'string') {

      return [{ role: 'user', content: [{ type: 'text', text: thread }] }] as T[]

    } else {

      const payloads: LLmCompletionPayload[] = []

      for (const msg of thread) {

        if (msg.contentForModel === null) {
          continue
        }

        // init the payload
        const payload: LlmCompletionPayloadContent = {
          role: msg.role as 'system'|'developer'|'user'|'assistant',
          content: this.requiresFlatTextPayload(model, msg) ? msg.contentForModel : [{
            type: 'text',
            text: msg.contentForModel,
            ...(this.requiresReasoningContent() && msg.reasoning ? { reasoning_content: msg.reasoning } : {}),
            ...(msg.thoughtSignature ? { thoughtSignature: msg.thoughtSignature } : {}),
          }],
          ...(msg.reasoningDetails ? { reasoning_details: msg.reasoningDetails } : {}),
        }
        
        // Attachments array may be absent when Message-like objects are supplied.
        const atts = Array.isArray((msg as any).attachments) ? (msg as any).attachments as Attachment[] : [];
        for (const attachment of atts) {
        
          // this can be a loaded chat where contents is not present
          if (attachment.content === null || attachment.content === undefined) {
            console.warn('Attachment contents not available. Skipping attachment.')
            continue
          }

          // text formats
          if (attachment.isText()) {
            this.addTextToPayload(model, msg, attachment, payload, opts)
          }

          // image formats
          if (attachment.isImage() && model.capabilities.vision) {
            this.addImageToPayload(model, attachment, payload, opts)
          }

        }

        if (msg.role === 'assistant' && msg.toolCalls.length > 0 && opts?.toolCallsInThread !== false) {

          payload.tool_calls = msg.toolCalls.map((tc: LlmToolCall) => {
            return {
              type: 'function',
              id: tc.id,
              function: {
                name: tc.function,
                arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
              },
              ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
            }
          })

        }

        // main payload
        payloads.push(payload)

        // tool calls response
        if (opts?.toolCallsInThread !== false) {
        
          for (const toolCall of msg.toolCalls) {

            const toolPayload: LlmCompletionPayloadTool = {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function,
              content: typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result),
            }
            payloads.push(toolPayload)

          }
        
        }

      }

      // done
      return payloads as T[]

    }
  }

  protected async getAvailableTools(): Promise<LlmTool[]> {

    const tools: LlmTool[] = []
    for (const plugin of this.plugins) {

      // needs to be enabled
      if (!plugin.isEnabled()) {
        continue
      }

      // some plugins are vendor specific and are handled
      // inside the LlmEngine concrete class
      if (!plugin.serializeInTools()) {
        continue
      }

      // others
      if ('getTools' in plugin) {
        const pluginAsTool = await (plugin as ICustomPlugin).getTools()
        if (Array.isArray(pluginAsTool)) {
          tools.push(...pluginAsTool)
        } else if (pluginAsTool) {
          tools.push(pluginAsTool)
        }
      } else {
        tools.push(this.getPluginAsTool(plugin as Plugin))
      }
    }
    return tools
  }

  // this is the default implementation as per OpenAI API
  // it is now almost a de facto standard and other providers
  // are following it such as MistralAI and others
  protected getPluginAsTool(plugin: Plugin): LlmTool {
    return {
      type: 'function',
      function: {
        name: plugin.getName(),
        description: plugin.getDescription(),
        parameters: {
          type: 'object',
          properties: plugin.getParameters().reduce((obj: any, param: PluginParameter) => {

            // basic stuff
            obj[param.name] = {
              type: param.type || (param.items ? 'array' : 'string'),
              description: param.description,
            }

            // enum is optional
            if (param.enum) {
              obj[param.name].enum = param.enum
            }

            // array can have no items => object
            // no properties => just a type
            // or an object with properties
            if (obj[param.name].type === 'array') {
              if (!param.items) {
                obj[param.name].items = { type: 'string' }
              } else if (!param.items.properties) {
                obj[param.name].items = { type: param.items.type }
              } else {
                obj[param.name].items = {
                  type: param.items.type || 'object',
                  properties: param.items.properties.reduce((obj: any, prop: LlmToolArrayItem) => {
                    obj[prop.name] = {
                      type: prop.type,
                      description: prop.description,
                    }
                    return obj
                  }, {}),
                  required: param.items.properties.filter((prop: LlmToolArrayItem) => prop.required).map(prop => prop.name),
                }
              }
            }
            return obj
          }, {}),
          required: plugin.getParameters().filter(param => param.required).map(param => param.name),
        },
      },
    }
  }

  protected getPluginForTool(tool: string): Plugin|null {

    const plugin = this.plugins.find((plugin) => plugin.getName() === tool)
    if (plugin) {
      return plugin as Plugin
    }

    // try multi-tools
    for (const plugin of Object.values(this.plugins)) {
      if (plugin instanceof MultiToolPlugin) {
        const multiToolPlugin = plugin as MultiToolPlugin
        if (multiToolPlugin.handlesTool(tool)) {
          return plugin
        }
      }
    }

    // not found
    return null

  }

  protected getToolPreparationDescription(tool: string): string {
    const plugin = this.getPluginForTool(tool)
    return plugin?.getPreparationDescription(tool) || ''
  }
  
  protected getToolRunningDescription(tool: string, args: any): string {
    const plugin = this.getPluginForTool(tool)
    return plugin?.getRunningDescription(tool, args) || ''
  }

  protected getToolCompletedDescription(tool: string, args: any, results: any): string|undefined {
    const plugin = this.getPluginForTool(tool)
    return plugin?.getCompletedDescription(tool, args, results)
  }

  protected getToolCanceledDescription(tool: string, args: any): string|undefined {
    const plugin = this.getPluginForTool(tool)
    return plugin?.getCanceledDescription(tool, args)
  }

  protected processToolExecutionResult(
    providerId: string,
    toolName: string,
    params: any,
    lastUpdate: PluginExecutionResult|undefined
  ): { content: any, canceled: boolean } {

    // Validate we got a result
    if (!lastUpdate) {
      throw new Error(`[${providerId}] tool call ${toolName} did not return any result`)
    }

    // Extract content with fallback
    const content = lastUpdate.result || { error: 'No result from tool' }
    logger.log(`[${providerId}] tool call ${toolName} => ${JSON.stringify(content).substring(0, 128)}`)

    // Handle abort decision - throw immediately
    if (lastUpdate.validation?.decision === 'abort') {
      const toolAbort: LlmChunkToolAbort = {
        type: 'tool_abort',
        name: toolName,
        params: params,
        reason: lastUpdate.validation,
      }
      throw toolAbort
    }

    // Detect cancellation (deny or explicit cancel)
    const canceled = lastUpdate.canceled === true || lastUpdate.validation?.decision === 'deny'

    return { content, canceled }
  }

  protected *processToolCallChunk(
    normalized: NormalizedToolChunk,
    context: { toolCalls: LlmToolCall[] }
  ): Generator<LlmChunk> {

    if (normalized.type === 'start') {
      // Start new tool call
      const toolCall: LlmToolCall = {
        id: normalized.id!,
        function: normalized.name!,
        args: normalized.args || '',
        message: normalized.message,
        ...normalized.metadata
      }
      context.toolCalls.push(toolCall)

      // Yield preparation notification (include metadata like thoughtSignature)
      yield {
        type: 'tool',
        id: toolCall.id,
        name: toolCall.function,
        state: 'preparing',
        status: this.getToolPreparationDescription(toolCall.function),
        ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
        done: false
      } as LlmChunk

    } else if (normalized.type === 'delta') {
      // Find target tool call - by id if provided (parallel tool calls), otherwise last
      const currentTool = normalized.id
        ? context.toolCalls.find(tc => tc.id === normalized.id)
        : context.toolCalls[context.toolCalls.length - 1]
      if (currentTool) {
        currentTool.args += normalized.argumentsDelta || ''
        // Update message if it has OpenAI/Groq/Mistral format (array with function.arguments)
        if (Array.isArray(currentTool.message) && currentTool.message.length > 0) {
          const lastMessage = currentTool.message[currentTool.message.length - 1]
          if (lastMessage?.function?.arguments !== undefined) {
            lastMessage.function.arguments = currentTool.args
          }
        }
      }
    }
  }

  /**
   * Execute tool calls with per-tool thread formatting (OpenAI/Groq/Mistral style).
   * Each tool call and result is added to thread immediately after execution.
   */
  protected async *executeToolCallsSequentially<T>(
    toolCalls: LlmToolCall[],
    context: LlmStreamingContext<T>,
    options: {
      formatToolCallForThread: (tc: LlmToolCall, args: any) => T,
      formatToolResultForThread: (result: any, tc: LlmToolCall, args: any) => T,
      createNewStream: (context: LlmStreamingContext<T>) => Promise<LlmStream>
    }
  ): AsyncGenerator<LlmChunk> {

    for (const toolCall of toolCalls) {
      const executed = yield* this.executeOneTool(toolCall, context)

      // Stop if aborted
      if (!executed) return

      // Add to thread immediately after each tool
      context.thread.push(options.formatToolCallForThread(toolCall, executed.args))
      context.thread.push(options.formatToolResultForThread(executed.result, toolCall, executed.args))
    }

    // Finalize: hook, sync, recurse
    yield* this.finalizeToolExecution(context, options.createNewStream)
  }

  /**
   * Execute tool calls with batched thread formatting (Anthropic/Google style).
   * All tool calls execute first, then all are added to thread at once.
   */
  protected async *executeToolCallsBatched<T>(
    toolCalls: LlmToolCall[],
    context: LlmStreamingContext<T>,
    options: {
      formatBatchForThread: (completed: CompletedToolCall[]) => T[],
      createNewStream: (context: LlmStreamingContext<T>) => Promise<LlmStream>
    }
  ): AsyncGenerator<LlmChunk> {

    const completedTools: CompletedToolCall[] = []

    for (const toolCall of toolCalls) {
      const executed = yield* this.executeOneTool(toolCall, context)

      // Stop if aborted
      if (!executed) return

      completedTools.push({ tc: toolCall, args: executed.args, result: executed.result })
    }

    // Add all to thread at once
    const batchMessages = options.formatBatchForThread(completedTools)
    for (const msg of batchMessages) {
      context.thread.push(msg)
    }

    // Finalize: hook, sync, recurse
    yield* this.finalizeToolExecution(context, options.createNewStream)
  }

  /**
   * Execute a single tool call. Shared by both sequential and batched methods.
   * Returns null if aborted, otherwise returns { args, result }.
   */
  private async *executeOneTool(
    toolCall: LlmToolCall,
    context: LlmStreamingContext
  ): AsyncGenerator<LlmChunk, { args: any, result: any } | null> {

    // Log the tool call
    logger.log(`[${this.getName()}] tool call ${toolCall.function} with ${toolCall.args}`)

    // Parse arguments
    let args = null
    try {
      args = JSON.parse(toolCall.args)
    } catch (err) {
      throw new Error(`[${this.getName()}] tool call ${toolCall.function} with invalid JSON args: "${toolCall.args}"`, { cause: err })
    }

    try {
      // Yield running notification
      yield {
        type: 'tool',
        id: toolCall.id,
        name: toolCall.function,
        state: 'running',
        status: this.getToolRunningDescription(toolCall.function, args),
        ...(toolCall.reasoningDetails ? { reasoningDetails: toolCall.reasoningDetails } : {}),
        call: {
          params: args,
          result: undefined
        },
        done: false
      } as LlmChunk

      // Execute tool
      let lastUpdate: PluginExecutionResult | undefined = undefined
      for await (const update of this.callTool(
        { model: context.model.id, abortSignal: context.opts?.abortSignal },
        toolCall.function,
        args,
        context.opts?.toolExecutionValidation
      )) {

        // Check for abort
        if (context.opts?.abortSignal?.aborted) {
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.function,
            state: 'canceled',
            status: this.getToolCanceledDescription(toolCall.function, args) || 'Tool execution was canceled',
            done: true,
            call: {
              params: args,
              result: undefined
            }
          } as LlmChunk
          return null
        }

        // Handle status updates
        if (update.type === 'status') {
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.function,
            state: 'running',
            status: update.status,
            call: {
              params: args,
              result: undefined
            },
            done: false
          } as LlmChunk
        } else if (update.type === 'result') {
          lastUpdate = update
        }
      }

      // Process result
      const { content, canceled: toolCallCanceled } = this.processToolExecutionResult(
        this.getName(),
        toolCall.function,
        args,
        lastUpdate
      )

      // Yield completed notification
      yield {
        type: 'tool',
        id: toolCall.id,
        name: toolCall.function,
        state: toolCallCanceled ? 'canceled' : 'completed',
        status: toolCallCanceled
          ? this.getToolCanceledDescription(toolCall.function, args) || content.error || 'Tool execution was canceled'
          : this.getToolCompletedDescription(toolCall.function, args, content),
        done: true,
        call: {
          params: args,
          result: content
        }
      } as LlmChunk

      // Add to tool history
      context.toolHistory.push({
        id: toolCall.id,
        name: toolCall.function,
        args: args,
        result: content,
        round: context.currentRound,
      })

      return { args, result: content }

    } catch (error: any) {

      // Handle abort
      if (context.opts?.abortSignal?.aborted) {
        yield {
          type: 'tool',
          id: toolCall.id,
          name: toolCall.function,
          state: 'canceled',
          status: this.getToolCanceledDescription(toolCall.function, args) || 'Tool execution was canceled',
          done: true,
          call: {
            params: args,
            result: undefined
          }
        } as LlmChunk
        throw error
      }

      // Handle other errors
      yield {
        type: 'tool',
        id: toolCall.id,
        name: toolCall.function,
        state: 'error',
        status: error.message,
        done: true,
        call: {
          params: args,
          result: undefined
        }
      } as LlmChunk
      throw error
    }
  }

  /**
   * Finalize tool execution: call hook, sync, and recurse.
   */
  private async *finalizeToolExecution<T>(
    context: LlmStreamingContext<T>,
    createNewStream: (context: LlmStreamingContext<T>) => Promise<LlmStream>
  ): AsyncGenerator<LlmChunk> {
    // Call hook before continuing
    await this.callHook('beforeToolCallsResponse', context)

    // Sync tool history to thread
    this.syncToolHistoryToThread(context)

    // Recurse: yield new stream to continue the conversation with tool results
    yield {
      type: 'stream',
      stream: await createNewStream(context)
    } as LlmChunk
  }

  protected async *callTool(context: PluginExecutionContext, tool: string, args: any, toolExecutionValidation: LlmToolExecutionValidationCallback|undefined): AsyncGenerator<PluginExecutionUpdate> {

    // get the plugin
    let payload = args
    let toolOwner = this.plugins.find((plugin) => plugin.getName() === tool)
    if (!toolOwner) {

      // try multi-tools
      for (const plugin of Object.values(this.plugins)) {
        if (plugin instanceof MultiToolPlugin) {
          const multiToolPlugin = plugin as MultiToolPlugin
          if (multiToolPlugin.handlesTool(tool)) {
            toolOwner = plugin
            payload = { tool: tool, parameters: args }
            break
          }
        }
      }

    }

    // check
    if (!toolOwner) {
      yield {
        type: 'result',
        result: { error: `Tool ${tool} does not exist. Check the tool list and try again.` }
      }
      return
    }

    // Check abort before calling tool
    if (context.abortSignal?.aborted) {
      yield {
        type: 'result',
        result: { error: 'Operation cancelled' },

        canceled: true
      }
      return
    }

    // if we have validator, call it
    let validation: LlmToolExecutionValidationResponse | undefined = undefined
    if (toolExecutionValidation) {
      validation = await toolExecutionValidation(context, tool, args)
      if (validation.decision !== 'allow') {
        yield {
          type: 'result',
          result: { error: `Tool ${tool} execution denied by validation function.` },
          validation
        }
        return
      }
    }

    // now we can run depending on plugin implementation
    if ('executeWithUpdates' in toolOwner) {

      for await (const update of toolOwner.executeWithUpdates!(context, payload)) {
        if (context.abortSignal?.aborted) {
          yield {
            type: 'result',
            result: { error: 'Operation cancelled' },
            canceled: true,
          ...(validation !== undefined ? { validation } : {}),
          }
          return
        }
        yield update
      }

    } else {

      // now we can run
      try {
        const result = await toolOwner.execute(context, payload)
        yield {
          type: 'result',
          result: result,
          ...(validation !== undefined ? { validation } : {}),
        }
      } catch (error) {
        // Check if this was a cancellation
        if (context.abortSignal?.aborted || (error instanceof Error && error.message === 'Operation cancelled')) {
          yield {
            type: 'result',
            result: { error: 'Operation cancelled' },
            canceled: true,
          ...(validation !== undefined ? { validation } : {}),
          }
        } else {
          throw error
        }
      }

    }

  }

  protected toModel(model: string|ChatModel): ChatModel {
    if (typeof model === 'object') {
      return model
    } else {
      return this.buildModel(model)
    }
  }

  buildModel(model: string): ChatModel {
    return {
      id: model,
      name: model,
      capabilities: this.getModelCapabilities({
        id: model,
        name: model,
      }),
    }
  }

}
