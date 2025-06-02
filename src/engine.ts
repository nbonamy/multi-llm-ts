/* eslint-disable @typescript-eslint/no-unused-vars */

import { ChatModel, EngineCreateOpts, Model, ModelCapabilities, ModelMetadata, ModelsList } from './types/index'
import { LlmResponse, LlmCompletionOpts, LLmCompletionPayload, LlmChunk, LlmTool, LlmToolArrayItem, LlmToolCall, LlmStreamingResponse, LlmStreamingContext, LlmUsage } from './types/llm'
import { PluginParameter } from './types/plugin'
import Message from './models/message'
import { Plugin, ICustomPlugin, MultiToolPlugin } from './plugin'
import Attachment from 'models/attachment'

export type LlmStreamingContextBase = {
  model: ChatModel
  thread: any[]
  opts: LlmCompletionOpts
  usage: LlmUsage
}

export type LlmStreamingContextTools = LlmStreamingContextBase & {
  toolCalls: LlmToolCall[]
}

export default abstract class LlmEngine {

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

  abstract getId(): string
  
  getName(): string {
    return this.getId()
  }

  abstract getModelCapabilities(model: ModelMetadata): ModelCapabilities
  
  abstract getModels(): Promise<ModelMetadata[]>
  
  protected abstract chat(model: Model, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse>

  protected abstract stream(model: Model, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse>

  abstract stop(stream: any): Promise<void>

  protected addTextToPayload(message: Message, attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts): void {

    if (Array.isArray(payload.content)) {
      
      // we may need to add to already existing content
      if (this.requiresFlatTextPayload(message)) {
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

  protected addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {

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

  protected abstract nativeChunkToLlmChunk(chunk: any, context: LlmStreamingContext): AsyncGenerator<LlmChunk, void, void>

  clearPlugins(): void {
    this.plugins = []
  }

  addPlugin(plugin: Plugin): void {
    this.plugins = this.plugins.filter((p) => p.getName() !== plugin.getName())
    this.plugins.push(plugin)
  }

  async complete(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const messages = this.buildPayload(model, thread, opts)
    return await this.chat(model, messages, opts)
  }

  async *generate(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> {
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

  requiresFlatTextPayload(msg: Message) {
    return ['system', 'assistant'].includes(msg.role)
  }

  buildPayload(model: ChatModel, thread: Message[] | string, opts?: LlmCompletionOpts): LLmCompletionPayload[] {

    if (typeof thread === 'string') {

      return [{ role: 'user', content: [{ type: 'text', text: thread }] }]

    } else {

      return thread.filter((msg) => msg.contentForModel !== null).map((msg): LLmCompletionPayload => {
        
        // init the payload
        const payload: LLmCompletionPayload = {
          role: msg.role,
          content: this.requiresFlatTextPayload(msg) ? msg.contentForModel : [{
            type: 'text',
            text: msg.contentForModel 
          }]
        }
        
        for (const attachment of msg.attachments) {
        
          // this can be a loaded chat where contents is not present
          if (attachment.content === null || attachment.content === undefined) {
            console.warn('Attachment contents not available. Skipping attachment.')
            continue
          }

          // text formats
          if (attachment.isText()) {
            this.addTextToPayload(msg, attachment, payload, opts)
          }

          // image formats
          if (attachment.isImage() && model.capabilities.vision) {
            this.addImageToPayload(attachment, payload, opts)
          }

        }

        // done
        return payload
      
      })
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
    return { error: `Tool ${tool} does not exist. Check the tool list and try again.` }

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

  zeroUsage(): LlmUsage {
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0,
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0
      }
    }
  }

}
