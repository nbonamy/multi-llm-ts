
import { EngineCreateOpts, Model } from 'types/index'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

//
// https://inference-docs.cerebras.ai/introduction
//

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
    const models = await super.getModels()

    // translate
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

  async getAvailableTools(): Promise<any[]> {
    return []
  }

}
