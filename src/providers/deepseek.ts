
import { EngineCreateOpts, Model } from 'types/index'
import { LlmRole } from 'types/llm'
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

    // translate
    const names: { [key: string]: string } = {
      'deepseek-chat': 'DeepSeek-V3',
      'deepseek-reasoner': 'DeepSeek-R1',
    }
    return models.map((model: Model) => ({
      ...model,
      name: names[model.id] || model.name
    }))

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
