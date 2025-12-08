import { ChatCompletionChunk } from 'openai/resources'
import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelGeneric, ModelsList } from '../types/index'
import { LlmChunk, LlmRole } from '../types/llm'
import OpenAI, { OpenAIStreamingContext } from './openai'

export const lmStudioBaseURL = 'http://localhost:1234/v1'

export default class extends OpenAI {

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static isConfigured = (engineConfig: EngineCreateOpts): boolean => {
    return true
  }

  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey || 'dummy',
      baseURL: config.baseURL || lmStudioBaseURL,
    })
  }

  getId(): string {
    return 'lmstudio'
  }

  getModelCapabilities(model: ModelGeneric): ModelCapabilities {
    
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

    // // Models that typically support tools lmstudio.ai/docs/app/api/tools
    // const toolModels = [
    //   'qwen2.5',
    //   'llama3.1',
    //   'llama-3.2',
    //   'mistral'
    // ]

    return {
      tools: true,//toolModels.some(m => model.id.includes(m)),
      vision: visionModels.some(m => model.id.includes(m)),
      reasoning: reasoningModels.some(m => model.id.includes(m)),
      caching: false,
    }
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<ModelGeneric[]> {
    return await super.getModels() as ModelGeneric[]
  }

  protected setBaseURL() {
    // avoid override by super
  }

  requiresFlatTextPayload(model: ChatModel, msg: Message): boolean {
    return super.defaultRequiresFlatTextPayload(model, msg)
  }

  async *nativeChunkToLlmChunk(chunk: ChatCompletionChunk, context: OpenAIStreamingContext): AsyncGenerator<LlmChunk> {

    // <think/> toggles thinking
    if (Array.isArray(chunk.choices) && chunk.choices.length > 0 && chunk.choices[0].delta) {
      if (chunk.choices[0].delta.content === '<think>') {
        context.thinking = true
        return
      } else if (chunk.choices[0].delta.content === '</think>') {
        context.thinking = false
        return
      }
    }
    
    // parent call
    for await (const c of super.nativeChunkToLlmChunk(chunk, context)) {
      yield c
    }
  }
}
