/* eslint-disable @typescript-eslint/no-unused-vars */

import { minimatch } from 'minimatch'
import { EngineCreateOpts, Model, ModelsList } from 'types/index'
import { LlmChunk, LlmCompletionOpts, LLmCompletionPayload, LlmResponse, LlmStream, LlmTool } from 'types/llm'
import { PluginParameter } from 'types/plugin'
import Message from './models/message'
import Plugin from './plugin'

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
    throw new Error('Not implemented')
  }

  async *generate(model: string, thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> {
    let stream: LlmStream|null = await this.stream(model, thread, opts)
    while (stream != null) {
      let stream2 = null
      for await (const chunk of stream) {
        const stream3 = this.nativeChunkToLlmChunk(chunk)
        for await (const msg of stream3) {
          if (msg.type === 'stream') {
            stream2 = msg.stream
          } else {
            yield msg
          }
        }
      }
      stream = stream2
    }
  }

  protected async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {
    throw new Error('Not implemented')
  }

  async stop(stream: any): Promise<void> {
    throw new Error('Not implemented')
  }

  protected addAttachmentToPayload(message: Message, payload: LLmCompletionPayload): void {
    throw new Error('Not implemented')
  }

  protected async *nativeChunkToLlmChunk(chunk: any): AsyncGenerator<LlmChunk, void, void> {
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

  protected findModel(models: Model[], filters: string[]): Model|null {
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

  protected buildPayload(model: string, thread: Message[] | string): LLmCompletionPayload[] {
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
          payload.content += `\n\n${msg.attachment.content}`
        }

        // image formats
        if (msg.attachment.isImage()) {
          if (!imageAttached && this.isVisionModel(model)) {
            this.addAttachmentToPayload(msg, payload)
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
      if (!plugin.sezializeInTools()) {
        continue
      }

      // others
      if (plugin.isMultiTool()) {
        const pluginAsTool = await plugin.getTools()
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

    const emptyProperty = {
      type: "object",
      properties: {},
      required: [],
    }

    const pluginParameters = plugin.getParameters()
    const properties = pluginParameters?.length ? pluginParameters.reduce((obj: any, param: PluginParameter) => {
      obj[param.name] = {
        type: param.type,
        enum: param.enum,
        description: param.description,
      }
      return obj
    }, {}) : emptyProperty

    const required = pluginParameters?.length ? plugin.getParameters().filter(param => param.required).map(param => param.name) : []

    return {
      type: 'function',
      function: {
        name: plugin.getName(),
        description: plugin.getDescription(),
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    }
  }

  protected getToolPreparationDescription(tool: string): string {
    const plugin = this.plugins.find((plugin) => plugin.getName() === tool)
    return plugin?.getPreparationDescription() || ''
  }
  
  protected getToolRunningDescription(tool: string): string {
    const plugin = this.plugins.find((plugin) => plugin.getName() === tool)
    return plugin?.getRunningDescription() || ''
  }

  protected async callTool(tool: string, args: any): Promise<any> {

    // get the plugin
    const plugin = this.plugins.find((plugin) => plugin.getName() === tool)
    if (plugin) {
      return await plugin.execute(args)
    }

    // try multi-tools
    for (const plugin of Object.values(this.plugins)) {
      if (plugin.isMultiTool() && plugin.handlesTool(tool)) {
        return await plugin.execute({ tool: tool, parameters: args })
      }
    }

    // too bad
    throw new Error(`Tool ${tool} not found`)
  }

}
