/* eslint-disable @typescript-eslint/no-unused-vars */

import { EngineCreateOpts, Model, ModelsList } from 'types/index'
import { LlmResponse, LlmCompletionOpts, LLmCompletionPayload, LlmChunk, LlmTool, LlmToolArrayItem, LlmToolCall, LlmStreamingResponse, LlmStreamingContext } from 'types/llm'
import { PluginParameter } from 'types/plugin'
import { minimatch } from 'minimatch'
import Message from './models/message'
import { Plugin, ICustomPlugin, MultiToolPlugin } from './plugin'

export type LlmStreamingContextBase = {
  model: string
  thread: any[]
  opts: LlmCompletionOpts
}

export type LlmStreamingContextTools = LlmStreamingContextBase & {
  toolCalls: LlmToolCall[]
}

export default class LlmEngine {

  config: EngineCreateOpts
  plugins: Plugin[]

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

  getName(): string {
    throw new Error('Not implemented')
  }

  getVisionModels(): string[] {
    throw new Error('Not implemented')
  }

  async getModels(): Promise<Model[]> {
    throw new Error('Not implemented')
  }
  
  isVisionModel(model: string): boolean {
    for (const filter of this.getVisionModels()) {
      if (minimatch(model, filter)) {
        return true
      }
    }
    return false
  }

  clearPlugins(): void {
    this.plugins = []
  }

  addPlugin(plugin: Plugin): void {
    this.plugins = this.plugins.filter((p) => p.getName() !== plugin.getName())
    this.plugins.push(plugin)
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const messages = this.buildPayload(model, thread, opts)
    return await this.chat(model, messages, opts)
  }

  async *generate(model: string, thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> {
    const response: LlmStreamingResponse|null = await this.stream(model, thread, opts)
    let stream = response?.stream
    while (true) {
      let stream2 = null
      for await (const chunk of stream) {
        const stream3 = this.nativeChunkToLlmChunk(chunk, response.context)
        for await (const msg of stream3) {
          if (msg.type === 'stream') {
            stream2 = msg.stream
          } else {
            // if we are switching to a new stream make sure we don't send a done message
            // (anthropic sends a 'message_stop' message when finishing current stream for example)
            if (stream2 !== null && msg.type === 'content' && msg.done) {
              msg.done = false
            }
            yield msg
          }
        }
      }
      if (!stream2) break
      stream = stream2
    }
  }

  protected async chat(model: string, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    throw new Error('Not implemented')
  }

  protected async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {
    throw new Error('Not implemented')
  }

  async stop(stream: any): Promise<void> {
    throw new Error('Not implemented')
  }

  protected addTextToPayload(message: Message, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {
    payload.content += `\n\n${message.attachment!.content}`
  }

  protected addImageToPayload(message: Message, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line require-yield
  protected async *nativeChunkToLlmChunk(chunk: any, context: LlmStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    throw new Error('Not implemented')
  }

  protected requiresVisionModelSwitch(thread: Message[], currentModel: string): boolean {
    
    // if we already have a vision
    if (this.isVisionModel(currentModel)) {
      return false
    }

    // check if amy of the messages in the thread have an attachment
    return thread.some((msg) => msg.attachment && msg.attachment.isImage())

  }

  findModel(models: Model[], filters: string[]): Model|null {
    for (const filter of filters) {
      for (const model of models) {
        if (minimatch(model.id, filter)) {
          return model
        }
      }
    }
    return null
  }

  protected selectModel(model: string, thread: Message[], opts?: LlmCompletionOpts): string {

    // init
    if (!opts || !opts.autoSwitchVision) {
      return model
    }

    // if we need to switch to vision
    if (this.requiresVisionModelSwitch(thread, model)) {

      // check
      if (!opts.models) {
        console.debug('Cannot switch to vision model as no models provided in LlmCompletionOpts')
        return model
      }

      // find the vision model
      const visionModel = this.findModel(opts.models, this.getVisionModels())
      if (visionModel) {
        return visionModel.id
      }
    }

    // no need to switch
    return model

  }

  buildPayload(model: string, thread: Message[] | string, opts?: LlmCompletionOpts): LLmCompletionPayload[] {
    if (typeof thread === 'string') {
      return [{ role: 'user', content: thread }]
    } else {

      // we only want to upload the last image attachment
      // so build messages in reverse order
      // and then reverse the array

      let imageAttached = false
      return thread.toReversed().filter((msg) => msg.contentForModel !== null).map((msg): LLmCompletionPayload => {
        const payload: LLmCompletionPayload = { role: msg.role, content: msg.contentForModel }
        
        // if there is no attachment, return
        if (!msg.attachment) {
          return payload
        }

        // this can be a loaded chat where contents is not present
        if (msg.attachment.content === null || msg.attachment.content === undefined) {
          console.warn('Attachment contents not available. Skipping attachment.')
          return payload
        }

        // text formats
        if (msg.attachment.isText()) {
          this.addTextToPayload(msg, payload, opts)
        }

        // image formats
        if (msg.attachment.isImage()) {
          if (!imageAttached && this.isVisionModel(model)) {
            this.addImageToPayload(msg, payload, opts)
            imageAttached = true
          }
        }

        // done
        return payload
      
      }).reverse()
    }
  }

  protected async getAvailableTools(): Promise<LlmTool[]> {
    
    const tools = []
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
        tools.push(this.getPluginAsTool(plugin))
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
      return plugin
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

  protected async callTool(tool: string, args: any): Promise<any> {

    // get the plugin
    const plugin = this.plugins.find((plugin) => plugin.getName() === tool)
    if (plugin) {
      return await plugin.execute(args)
    }

    // try multi-tools
    for (const plugin of Object.values(this.plugins)) {
      if (plugin instanceof MultiToolPlugin) {
        const multiToolPlugin = plugin as MultiToolPlugin
        if (multiToolPlugin.handlesTool(tool)) {
          return await plugin.execute({ tool: tool, parameters: args })
        }
      }
    }

    // too bad
    throw new Error(`Tool ${tool} not found`)
  }

}
