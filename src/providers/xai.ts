
import { EngineCreateOpts, Model } from 'types/index'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

//
// https://docs.x.ai/docs/introduction#what-is-grok-and-xai-api
//

export const xAIBaseURL = 'https://api.x.ai/v1'

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
    const models = await super.getModels()

    // sort and transform
    return models
      .sort((a: Model, b: Model) => b.meta.created - a.meta.created)
      .map((model: Model) => ({
        ...model,
        name: model.name.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
      }))

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
