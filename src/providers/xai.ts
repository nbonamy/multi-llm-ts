
import { EngineCreateOpts, ModelCapabilities, ModelxAI } from '../types/index'
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
      baseURL: xAIBaseURL,
    })
  }

  getName(): string {
    return 'xai'
  }

  getModelCapabilities(model: string): ModelCapabilities {
    const vision = model.includes('vision')
    return {
      tools: !vision,
      vision: vision,
      reasoning: false,
    }
  }

  get systemRole(): LlmRole {
    return 'system'
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

}
