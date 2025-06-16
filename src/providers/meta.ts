
import Message from '../models/message'
import { EngineCreateOpts, ModelCapabilities, ModelMeta } from '../types/index'
import { LlmRole } from '../types/llm'
import { minimatch } from 'minimatch'
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

  getId(): string {
    return 'meta'
  }

  getModelCapabilities(model: ModelMeta): ModelCapabilities {
    const visionGlobs = [ '*Llama-4-*' ]
    return {
      tools: true,
      vision: visionGlobs.some((m) => minimatch(model.id, m)),
      reasoning: false,
      responses: false,
    }
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<ModelMeta[]> {
    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return await super.getModels() as ModelMeta[]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  requiresFlatTextPayload(msg: Message): boolean {
    return super.defaultRequiresFlatTextPayload(msg)
  }

}
