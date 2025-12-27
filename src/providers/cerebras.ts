import { ChatCompletionChunk } from 'openai/resources'
import Message from '../models/message'
import { ChatModel, EngineCreateOpts, Model, ModelCerebras } from '../types/index'
import { LlmChunk, LlmRole } from '../types/llm'
import OpenAI, { OpenAIStreamingContext } from './openai'

//
// https://inference-docs.cerebras.ai/introduction
//

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.cerebras.ai/v1',
    })
  }

  getId(): string {
    return 'cerebras'
  }

  supportsServiceTiering(): boolean {
    return false
  }
  
  getVisionModels(): string[] {
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsTopK(model: Model): boolean {
    return false
  }
  
  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<ModelCerebras[]> {
    
    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return await super.getModels() as ModelCerebras[]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  async getAvailableTools(): Promise<any[]> {
    return []
  }

  // cerebras supports multiparts for some models but not all
  // especially qwen-3-32b will fail with
  // {
  //   "message": "Failed to apply chat template to messages due to error: 'list object' has no attribute 'startswith'",
  //   "type": "invalid_request_error",
  //   "param": "messages",
  //   "code": "wrong_api_format"
  // }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requiresFlatTextPayload(model: ChatModel, msg: Message): boolean {
    return true
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
