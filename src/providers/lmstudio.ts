import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelLMStudio, ModelsList } from '../types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmStreamingContext, LlmToolCall, LlmToolCallInfo, LlmUsage } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'

//
// https://github.com/lmstudio-ai/lmstudio-js/
// This is a custom LLM engine for LM Studio, which allows interaction with models loaded in the LM Studio environment.
// To start the LMStudio Server, run in terminal: lms server start
// Load models into LM Studio using the UI or CLI, then use this engine to interact with them.

import { LMStudioClient } from "@lmstudio/sdk"
import OpenAI from 'openai'
import { ChatCompletionChunk } from 'openai/resources'

const defaultBaseUrl = 'http://localhost:1234'

export type LMStudioStreamingContext = LlmStreamingContextTools & {
  usage: LlmUsage
}

export default class extends LlmEngine {

  client: LMStudioClient
  openaiClient: OpenAI

  static isConfigured = (engineConfig: EngineCreateOpts): boolean => {
    return true
  }
  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    super(config)
    const baseUrl = config.baseURL || defaultBaseUrl
    this.client = new LMStudioClient({
      baseUrl: baseUrl
    })
    
    // Convert WebSocket URL to HTTP URL for OpenAI client
    let httpBaseUrl = baseUrl
    if (baseUrl.startsWith('ws://')) {
      httpBaseUrl = baseUrl.replace('ws://', 'http://')
    } else if (baseUrl.startsWith('wss://')) {
      httpBaseUrl = baseUrl.replace('wss://', 'https://')
    }
    
    // Initialize OpenAI client for streaming using LM Studio's OpenAI-compatible API
    this.openaiClient = new OpenAI({
      apiKey: 'lm-studio', // LM Studio doesn't require a real API key
      baseURL: `${httpBaseUrl}/v1`,
      dangerouslyAllowBrowser: true
    })
  }

  getId(): string {
    return 'lmstudio'
  }
  getModelCapabilities(model: ModelLMStudio): ModelCapabilities {
    // For LMStudio, we need to make some assumptions about capabilities
    // since the SDK doesn't provide detailed capability information
    
    // Models that typically support vision
    
    const visionModels = [
      'llava',
      'llama3.2-vision',
      'qwen2.5vl',
      'minicpm-v',
      'moondream',
    ]

    // Models that typically support reasoning
    const reasoningModels = [
      'qwq',
      'thinking',
      'reasoning',
      'cogito',
    ]

    // Models that typically support tools lmstudio.ai/docs/app/api/tools
    const toolModels = [
      'qwen2.5',
      'llama3.1',
      'mistral'
    ]

    const modelName = model.name.toLowerCase()
    
    return {
      tools: toolModels.some(m => modelName.includes(m)),
      vision: visionModels.some(m => modelName.includes(m)),
      reasoning: reasoningModels.some(m => modelName.includes(m)),
    }
  }
  async getModels(): Promise<ModelLMStudio[]> {
    try {
      const models = await this.client.llm.listLoaded()
      return models.map((model: any) => ({
        ...model,
        id: model.path || model.name || 'unknown',
        name: model.path || model.name || 'unknown',
      }))
    } catch (error) {
      console.error('Error listing LMStudio models:', error)
      return []
    }
  }
  
  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    try {
      logger.log(`[lmstudio] prompting model ${model.id}`)
      
      // Get the model instance
      const lmModel = await this.client.llm.model(model.id)
      
      // Build the conversation prompt from thread
      const prompt = this.buildPromptFromThread(thread)
      
      let result: any
      
      if (opts?.tools && this.plugins.length > 0) {
        logger.log(`[lmstudio] using tools with .act() method`)
        
        // Convert plugins to LMStudio SDK format tools
        const lmTools = this.convertPluginsToLMStudioTools()
        
        result = await lmModel.act(prompt, lmTools, {
          maxTokens: opts?.maxTokens,
          temperature: opts?.temperature,
        })
      } else {
        result = await lmModel.respond(prompt, {
          maxTokens: opts?.maxTokens,
          temperature: opts?.temperature,
        })
      }

      return {
        type: 'text',
        content: result.content || result,
        toolCalls: result.toolCalls || [],
        ...(opts?.usage ? {
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
          }
        } : {})
      }
    } catch (error) {
      logger.log(`[lmstudio] error: ${error}`)
      throw error
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {
    // Create streaming context
    const context: LMStudioStreamingContext = {
      model: model,
      thread: this.buildPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }

    return {
      stream: await this.doStream(context),
      context: context
    }
  }
  
  async doStream(context: LMStudioStreamingContext): Promise<LlmStream> {
    logger.log(`[lmstudio] streaming model ${context.model.id}`)
    
    try {
      // Convert thread to OpenAI-compatible messages format
      const messages = this.convertThreadToMessages(context.thread)
      
      if (context.opts.tools && this.plugins.length > 0) {
        logger.log(`[lmstudio] streaming with tools - falling back to LMStudio SDK`)
        // For tools, fall back to LMStudio SDK since OpenAI compatibility may not support all tool features
        const lmModel = await this.client.llm.model(context.model.id)
        const prompt = this.buildPromptFromThread(context.thread)
        const lmTools = this.convertPluginsToLMStudioTools()
        
        const streamGenerator = async function* () {
          try {
            const result = await lmModel.act(prompt, lmTools, {
              maxTokens: context.opts.maxTokens,
              temperature: context.opts.temperature,
            })
            
            // Simulate streaming for tool responses
            // Handle different result formats from LMStudio SDK
            let content: string
            if (typeof result === 'string') {
              content = result
            } else if (result && typeof result === 'object' && 'content' in result) {
              content = (result as any).content || ''
            } else {
              content = String(result || '')
            }
            
            const chunkSize = 10
            for (let i = 0; i < content.length; i += chunkSize) {
              const chunk = content.slice(i, i + chunkSize)
              const llmChunk: LlmChunk = {
                type: 'content',
                text: chunk,
                done: i + chunkSize >= content.length
              }
              yield llmChunk
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          } catch (error) {
            logger.log(`[lmstudio] tool streaming error: ${error}`)
            throw error
          }
        }
        
        return streamGenerator()
      } else {
        // Use OpenAI-compatible streaming for regular chat
        logger.log(`[lmstudio] using OpenAI-compatible streaming`)
        const stream = await this.openaiClient.chat.completions.create({
          model: context.model.id,
          messages: messages,
          stream: true,
          ...(context.opts.maxTokens ? { max_tokens: context.opts.maxTokens } : {}),
          ...(context.opts.temperature !== undefined ? { temperature: context.opts.temperature } : {}),
        })
        
        // Transform the OpenAI stream to LlmChunk format
        const transformedStream = async function* (this: any) {
          try {
            for await (const chunk of stream) {
              yield* this.nativeChunkToLlmChunk(chunk, context)
            }
          } catch (error) {
            logger.log(`[lmstudio] OpenAI streaming error: ${error}`)
            throw error
          }
        }.bind(this)
        
        return transformedStream()
      }
    } catch (error) {
      logger.log(`[lmstudio] streaming setup error: ${error}`)
      throw error
    }
  }

  async stop(stream: any): Promise<void> {
    // For OpenAI-compatible streams, try to abort the controller
    if (stream?.controller?.abort) {
      stream.controller.abort()
    }
    logger.log('[lmstudio] stop called')
  }

  protected async* nativeChunkToLlmChunk(chunk: ChatCompletionChunk, context: LlmStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    // Convert OpenAI-compatible chunks to LlmChunk format
    const choice = chunk.choices?.[0]
    if (choice?.delta?.content) {
      yield {
        type: 'content',
        text: choice.delta.content,
        done: choice.finish_reason !== null
      }
    }
    
    // Handle usage information if available
    if (chunk.usage && context.opts?.usage) {
      const lmStudioContext = context as LMStudioStreamingContext
      lmStudioContext.usage = {
        prompt_tokens: chunk.usage.prompt_tokens || 0,
        completion_tokens: chunk.usage.completion_tokens || 0
      }
    }
  }
  private buildPromptFromThread(thread: LLmCompletionPayload[]): string {
    // Convert thread messages to a single prompt string
    // This is a more sophisticated implementation to handle different content types
    return thread.map(msg => {
      let content = ''
      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        // Handle multimodal content (text and images)
        content = msg.content.map(item => {
          if (item.type === 'text') {
            return item.text || ''
          } else if (item.type === 'image_url') {
            return `[Image: ${item.image_url?.url || 'unknown'}]`
          }
          return ''
        }).join(' ')
      } else {
        content = JSON.stringify(msg.content)
      }

      if (msg.role === 'system') {
        return `System: ${content}`
      } else if (msg.role === 'user') {
        return `User: ${content}`
      } else if (msg.role === 'assistant') {
        return `Assistant: ${content}`
      } else if (msg.role === 'tool') {
        return `Tool: ${content}`
      }
      return content
    }).filter(Boolean).join('\n\n')
  }

  private convertPluginsToLMStudioTools(): any[] {
    // Convert plugins to LMStudio SDK tool format
    // This is a placeholder implementation - would need to be expanded based on plugin structure
    return this.plugins.map(plugin => ({
      name: plugin.getName(),
      description: plugin.getDescription(),
      parameters: plugin.getParameters() || {},
      implementation: async (params: any) => {
        return await plugin.execute(params)
      }
    }))
  }


  
  async deleteModel(model: string): Promise<void> {
    // LMStudio doesn't have a direct delete API like Ollama
    // This would need to be done through the LMStudio UI
    console.warn('LMStudio does not support deleting models via API. Use the LMStudio UI to manage models.')
  }

  getName(): string {
    return 'LMStudio'
  }

  private convertThreadToMessages(thread: LLmCompletionPayload[]): any[] {
    // Convert thread to OpenAI-compatible messages format
    return thread.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }))
  }
}
