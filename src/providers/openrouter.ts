
import { EngineCreateOpts, ModelCapabilities, ModelOpenRouter } from '../types/index'
import { LlmRole } from '../types/llm'
import OpenAI from './openai'

//
// https://openrouter.ai/docs/quick-start
//

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    })
  }

  getName(): string {
    return 'openrouter'
  }

  async getModels(): Promise<ModelOpenRouter[]> {
    return await super.getModels() as ModelOpenRouter[]
  }

  getModelCapabilities(model: string|ModelOpenRouter): ModelCapabilities {

    if (typeof model === 'string') {
      return { tools: false, vision: false, reasoning: false }
    }

    let input_modalities: string[] = model.architecture?.input_modalities
    if (!input_modalities && model.architecture.modality) {
      input_modalities = model.architecture.modality.split('->')[0].split('+')
    }

    return {
      tools: model.supported_parameters?.includes('tools') ?? false,
      vision: input_modalities?.includes('image') ?? false,
      reasoning: model.supported_parameters?.includes('reasoning') ?? false,
    }

  }

  get systemRole(): LlmRole {
    return 'system'
  }

  protected setBaseURL() {
    // avoid override by super
  }

}
