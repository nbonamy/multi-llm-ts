/* eslint-disable @typescript-eslint/no-unused-vars */

import { anyDict, EngineConfig, Model } from 'types/index.d'
import { LlmResponse, LlmCompletionOpts, LLmCompletionPayload, LlmStream, LlmChunk, LlmTool } from 'types/llm.d'
import { PluginParameter } from 'types/plugin.d'
import { minimatch } from 'minimatch'
import Message from './models/message'
import Plugin from './plugin'

export default class LlmEngine {

  config: EngineConfig
  plugins: { [key: string]: Plugin }

  static isConfigured = (engineConfig: EngineConfig): boolean => {
    return engineConfig?.apiKey?.length > 0
  }

  static isReady = (engineConfig: EngineConfig): boolean => {
    return LlmEngine.isConfigured(engineConfig) && engineConfig?.models?.chat?.length > 0
  }
  
  constructor(config: EngineConfig) {
    this.config = config
    this.plugins = {}
  }

  getName(): string {
    throw new Error('Not implemented')
  }

  getVisionModels(): string[] {
    throw new Error('Not implemented')
  }

  async getModels(): Promise<any[]> {
    throw new Error('Not implemented')
  }
  
  getChatModel(): string {
    return this.config.model?.chat
  }

  getChatModels(): Model[] {
    return this.config.models?.chat
  }

  isVisionModel(model: string): boolean {
    for (const filter of this.getVisionModels()) {
      if (minimatch(model, filter)) {
        return true
      }
    }
    return false
  }

  addPlugin(plugin: Plugin): void {
    if (plugin.isEnabled()) {
      this.plugins[plugin.getName()] = plugin
    }
  }

  async complete(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    throw new Error('Not implemented')
  }

  async *generate(thread: Message[], opts?: LlmCompletionOpts): AsyncGenerator<LlmChunk, void, void> {
    let stream = await this.stream(thread, opts)
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

  protected async stream(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {
    throw new Error('Not implemented')
  }

  async image(prompt: string, opts?: LlmCompletionOpts): Promise<LlmResponse> {
    throw new Error('Not implemented')
  }

  async stop(stream: any): Promise<void> {
    throw new Error('Not implemented')
  }

  protected addImageToPayload(message: Message, payload: LLmCompletionPayload) {
    throw new Error('Not implemented')
  }

  protected async *nativeChunkToLlmChunk(chunk: any): AsyncGenerator<LlmChunk, void, void> {
    throw new Error('Not implemented')
    yield { type: 'content', text: '', done: true }
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

  protected selectModel(thread: Message[], currentModel: string): string {

    // if we need to switch to vision
    if (this.requiresVisionModelSwitch(thread, currentModel)) {

      // find the vision model
      const visionModel = this.findModel(this.getChatModels(), this.getVisionModels())
      if (visionModel) {
        return visionModel.id
      }
    }

    // no need to switch
    return currentModel

  }

  protected buildPayload(thread: Message[] | string, model: string): LLmCompletionPayload[] {
    if (typeof thread === 'string') {
      return [{ role: 'user', content: thread }]
    } else {

      // we only want to upload the last image attachment
      // so build messages in reverse order
      // and then reverse the array

      let imageAttached = false
      return thread.toReversed().filter((msg) => msg.content !== null).map((msg): LLmCompletionPayload => {
        const payload: LLmCompletionPayload = { role: msg.role, content: msg.content }
        
        // if there is no attachment, return
        if (!msg.attachment) {
          return payload
        }

        // this can be a loaded chat where contents is not present
        if (msg.attachment.contents === null || msg.attachment.contents === undefined) {
          console.warn('Attachment contents not available. Skipping attachment.')
          return payload
        }

        // text formats
        if (msg.attachment.isText()) {
          payload.content += `\n\n${msg.attachment.contents}`
        }

        // image formats
        if (msg.attachment.isImage()) {
          if (!imageAttached && this.isVisionModel(model)) {
            this.addImageToPayload(msg, payload)
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
    for (const pluginName in this.plugins) {

      // some plugins are vendor specific and are handled
      // inside the LlmEngine concrete class
      const plugin = this.plugins[pluginName]
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
    return {
      type: 'function',
      function: {
        name: plugin.getName(),
        description: plugin.getDescription(),
        parameters: {
          type: 'object',
          properties: plugin.getParameters().reduce((obj: anyDict, param: PluginParameter) => {
            obj[param.name] = {
              type: param.type,
              enum: param.enum,
              description: param.description,
            }
            return obj
          }, {}),
          required: plugin.getParameters().filter(param => param.required).map(param => param.name),
        },
      },
    }
  }

  protected getToolPreparationDescription(tool: string): string {
    const plugin = this.plugins[tool]
    return plugin?.getPreparationDescription()
  }
  
  protected getToolRunningDescription(tool: string): string {
    const plugin = this.plugins[tool]
    return plugin?.getRunningDescription()
  }

  protected async callTool(tool: string, args: any): Promise<any> {

    // get the plugin
    const plugin: Plugin = this.plugins[tool]
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
