import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelDeepseek } from '../types/index'
import { LlmRole } from '../types/llm'
import OpenAI from './openai'

//
// https://api-docs.deepseek.com
//

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
    })
  }

  getId(): string {
    return 'deepseek'
  }

  getVisionModels(): string[] {
    return [ ]
  }

  getModelCapabilities(model: ModelDeepseek): ModelCapabilities {
    return {
      tools: true,
      vision: false,
      reasoning: model.id.includes('reason'),
      caching: false,
    }
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsReasoningEffort(model: ChatModel): boolean {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  modelSupportsStructuredOutput(model: ChatModel): boolean {
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

  requiresFlatTextPayload(model: ChatModel, msg: Message): boolean {
    if (msg.role === 'assistant' && msg.reasoning) {
      return false
    } else {
      return super.defaultRequiresFlatTextPayload(model, msg)
    }
  }

  requiresReasoningContent(): boolean {
    return true
  }

}
