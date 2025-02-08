
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

  modelIsReasoning(model: string): boolean {
    return model.includes('reason')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsReasoningEffort(model: string): boolean {
    return false
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
    return models.map((model: Model) => ({
      ...model,
      name: model.name.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ').replace('Deepseek', 'DeepSeek'),
    }))

  }

  protected setBaseURL() {
    // avoid override by super
  }

}
