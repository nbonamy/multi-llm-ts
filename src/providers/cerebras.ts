
import { EngineCreateOpts, Model, ModelCerebras } from '../types/index'
import { LlmRole } from '../types/llm'
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

  getId(): string {
    return 'cerebras'
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

}
