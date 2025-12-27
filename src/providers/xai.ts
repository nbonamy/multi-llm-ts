import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelxAI } from '../types/index'
import { LlmRole } from '../types/llm'
import OpenAI from './openai'

//
// https://docs.x.ai/docs/introduction#what-is-grok-and-xai-api
//

export const xAIBaseURL = 'https://api.x.ai/v1'

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: config.baseURL || xAIBaseURL,
    })
  }

  getId(): string {
    return 'xai'
  }

  supportsServiceTiering(): boolean {
    return false
  }
  
  getModelCapabilities(model: ModelxAI): ModelCapabilities {
    const vision = model.id.includes('vision')
    const reasoning = model.id.includes('grok-3-mini')
    return {
      tools: !vision,
      vision: vision,
      reasoning: reasoning,
      caching: false,
    }
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  doesNotSendToolCallFinishReason(model: ChatModel): boolean {
    return true
  }

  async getModels(): Promise<ModelxAI[]> {
    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return await super.getModels() as ModelxAI[]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  requiresFlatTextPayload(model: ChatModel, msg: Message): boolean {
    return super.defaultRequiresFlatTextPayload(model, msg)
  }

}
