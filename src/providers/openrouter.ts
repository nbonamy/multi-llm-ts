
import { EngineCreateOpts, Model } from 'types/index'
import { LlmRole } from 'types/llm'
import OpenAI from './openai'

//
// https://openrouter.ai/docs/quick-start
//

export default class extends OpenAI {

  models: Model[]

  constructor(config: EngineCreateOpts, models: Model[] = []) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })
    this.models = models
  }

  getName(): string {
    return 'openrouter'
  }

  async getModels(): Promise<Model[]> {
    this.models = await super.getModels()
    return this.models
  }

  _isVisionModel(modelId: string): boolean {

    // find meta data
    const model = this.models?.find((m) => m.id === modelId)
    if (model?.meta?.architecture) {
      
      // check input modalities 1st
      let input_modalities = model.meta.architecture.input_modalities
      if (!input_modalities && model.meta.architecture.modality) {
        input_modalities = model.meta.architecture.modality.split('->')[0].split('+')
      }

      // if we have a valid input modalities, check if it includes image
      if (input_modalities) {
        return input_modalities.includes('image')
      }
    }
    
    // we don't know
    return false
  }

  getVisionModels(): string[] {
    return this.models.filter((model) => this._isVisionModel(model.id)).map((model) => model.id)
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsTools(model: string): boolean {
    return true
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  protected setBaseURL() {
    // avoid override by super
  }

}
