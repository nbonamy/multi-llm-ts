
import { EngineCreateOpts, Model } from 'types/index'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

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
    return [
      { id: 'deepseek-chat', name: 'DeepSeek-V3' },
    ]

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
