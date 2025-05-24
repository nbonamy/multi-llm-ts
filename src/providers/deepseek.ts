
import { EngineCreateOpts, Model, ModelCapabilities, ModelDeepseek } from '../types/index'
import { LlmRole } from '../types/llm'
import OpenAI from './openai'

//
// https://api-docs.deepseek.com
//

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://api.deepseek.com/v1',
    })
  }

  getName(): string {
    return 'deepseek'
  }

  getVisionModels(): string[] {
    return [ ]
  }

  getModelCapabilities(model: string): ModelCapabilities {
    return {
      tools: true,
      vision: false,
      reasoning: model.includes('reason'),
    }
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsReasoningEffort(model: string|Model): boolean {
    return false
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<ModelDeepseek[]> {
    
    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return await super.getModels() as ModelDeepseek[]

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
