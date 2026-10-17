import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelWebWright } from '../types/index'
import { LlmRole } from '../types/llm'
import { PROVIDER_BASE_URLS } from '../defaults'
import OpenAI from './openai'

//
// https://webwright.ai/v1
//

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: config.baseURL || PROVIDER_BASE_URLS.webwright!,
    })
  }

  getId(): string {
    return 'webwright'
  }

  supportsServiceTiering(): boolean {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getModelCapabilities(model: ModelWebWright): ModelCapabilities {
    return {
      tools: true,
      vision: false,
      reasoning: true,
      caching: true,
    }
  }

  // WebWright does not document structured output for wren-r1, so the
  // inherited OpenAI json_schema response format is not sent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsStructuredOutput(model: ChatModel): boolean {
    return false
  }

  get systemRole(): LlmRole {
    return 'system'
  }

  async getModels(): Promise<ModelWebWright[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return await super.getModels() as ModelWebWright[]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  requiresFlatTextPayload(model: ChatModel, msg: Message): boolean {
    return super.defaultRequiresFlatTextPayload(model, msg)
  }

}
