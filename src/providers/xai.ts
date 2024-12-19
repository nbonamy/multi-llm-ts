
import { EngineCreateOpts, Model } from 'types/index.d'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://api.x.ai/v1',
    })
  }

  getName(): string {
    return 'xai'
  }

  getVisionModels(): string[] {
    return [ '*vision*' ]
  }
  
  modelSupportsTools(model: string): boolean {
    return !model.includes('vision')
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
      { id: 'grok-beta', name: 'Grok 2' },
      { id: 'grok-vision-beta', name: 'Grok Vision' },
    ]

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
