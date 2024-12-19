
import { EngineCreateOpts, Model } from 'types/index.d'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://api.cerebras.ai/v1',
    })
  }

  getName(): string {
    return 'cerebras'
  }

  getVisionModels(): string[] {
    return []
  }
  
  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<Model[]> {
    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return [
      { id: 'llama3.1-8b', name: 'Llama 3.1 8b' },
      { id: 'llama3.1-70b', name: 'Llama 3.1 70b' },
    ]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  async getAvailableTools(): Promise<any[]> {
    return []
  }

}
