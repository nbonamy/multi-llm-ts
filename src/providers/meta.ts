
import { EngineCreateOpts, Model } from '../types/index'
import { LlmRole } from '../types/llm'
import OpenAI from './openai'

//
// https://llama.developer.meta.com/docs/overview
//

export const metaBaseURL = 'https://api.llama.com/compat/v1/'

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: metaBaseURL,
    })
  }

  getName(): string {
    return 'meta'
  }

  getVisionModels(): string[] {
    return [ '*Llama-4-*' ]
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsTools(model: string): boolean {
    return true
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

    // sort
    return models.sort((a: Model, b: Model) => b.meta.created - a.meta.created)

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
