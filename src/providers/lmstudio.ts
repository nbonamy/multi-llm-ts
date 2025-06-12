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

const defaultBaseUrl = 'http://localhost:1234'

export type LMStudioStreamingContext = LlmStreamingContextTools & {
  usage: LlmUsage
}

export default class extends LlmEngine {

  client: LMStudioClient

  static isConfigured = (engineConfig: EngineCreateOpts): boolean => {
    return true
  }
  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new LMStudioClient({
      baseUrl: config.baseURL || defaultBaseUrl
    })
  }

  getId(): string {
    return 'lmstudio'
  }
  getModelCapabilities(model: ModelLMStudio): ModelCapabilities {
    // For LMStudio, we need to make some assumptions about capabilities
    // since the SDK doesn't provide detailed capability information
    
    // Models that typically support tools
    const toolModels = [
      'llama3',
      'llama3.1',
      'llama3.2',
      'llama3.3',
      'qwen2',
      'qwen2.5',
      'qwen3',
      'mistral',
      'mixtral',
      'granite',
      'codellama',
    ]

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
  }  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    try {
      logger.log(`[lmstudio] prompting model ${model.id}`)
      
      // Get the model instance
      const lmModel = await this.client.llm.model(model.id)
      
      // Build the conversation prompt from thread
      const prompt = this.buildPromptFromThread(thread)
        // Check if tools are requested (LMStudio doesn't support tools natively)
      if (opts?.tools) {
        logger.log(`[lmstudio] warning: tools requested but not supported by LMStudio`)
      }
      
      // Make the request
      const result = await lmModel.respond(prompt, {
        maxTokens: opts?.maxTokens,
        temperature: opts?.temperature,
        // Add other options as supported by LMStudio SDK
      })

      return {
        type: 'text',
        content: result.content,
        toolCalls: [], // LMStudio doesn't support tool calls
        ...(opts?.usage ? { 
          usage: {
            prompt_tokens: 0, // LMStudio SDK might not provide token counts
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
  }  async doStream(context: LMStudioStreamingContext): Promise<LlmStream> {
    logger.log(`[lmstudio] streaming model ${context.model.id}`)
    
    try {
      // Get the model instance
      const lmModel = await this.client.llm.model(context.model.id)
      
      // Build the conversation prompt from thread
      const prompt = this.buildPromptFromThread(context.thread)
      
      // Create async generator for streaming
      const streamGenerator = async function* () {
        try {
          // LMStudio SDK doesn't have native streaming, so we simulate it
          const result = await lmModel.respond(prompt, {
            maxTokens: context.opts.maxTokens,
            temperature: context.opts.temperature,
          })

          // Simulate streaming by yielding the content in chunks
          const content = result.content
          const chunkSize = 10
          for (let i = 0; i < content.length; i += chunkSize) {
            const chunk = content.slice(i, i + chunkSize)
            const llmChunk: LlmChunk = {
              type: 'content',
              text: chunk,
              done: i + chunkSize >= content.length
            }
            yield llmChunk
            // Add small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        } catch (error) {
          logger.log(`[lmstudio] streaming error: ${error}`)
          throw error
        }
      }

      return streamGenerator()
    } catch (error) {
      logger.log(`[lmstudio] streaming setup error: ${error}`)
      throw error
    }
  }

  async stop(stream: any): Promise<void> {
    // LMStudio SDK might not support stopping streams
    // This is a placeholder implementation
    logger.log('[lmstudio] stop called')
  }

  protected async* nativeChunkToLlmChunk(chunk: any, context: LlmStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    // Convert native LMStudio chunks to LlmChunk format
    yield {
      type: 'content',
      text: chunk.content || '',
      done: chunk.done || false
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

  async getModelInfo(model: string): Promise<any|null> {
    try {
      // LMStudio SDK might not have a direct equivalent to getModelInfo
      // We can try to get the model and return some basic info
      const loadedModels = await this.getModels()
      const foundModel = loadedModels.find(m => m.id === model || m.name === model)
      return foundModel || null
    } catch (error) {
      console.error('Error getting LMStudio model info:', error)
      return null
    }
  }

  async pullModel(model: string): Promise<any|null> {
    // LMStudio doesn't have a direct pull/download API like Ollama
    // This would need to be done through the LMStudio UI
    console.warn('LMStudio does not support pulling models via API. Use the LMStudio UI to download models.')
    return null
  }
  
  async deleteModel(model: string): Promise<void> {
    // LMStudio doesn't have a direct delete API like Ollama
    // This would need to be done through the LMStudio UI
    console.warn('LMStudio does not support deleting models via API. Use the LMStudio UI to manage models.')
  }

  getName(): string {
    return 'LMStudio'
  }
}
