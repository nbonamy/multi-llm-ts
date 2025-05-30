
import { EngineCreateOpts, ModelOpenAI } from '../types/index'
import Message from '../models/message'
import { AzureOpenAI } from 'openai'
import OpenAI from './openai'

export default class extends OpenAI {

  constructor(config: EngineCreateOpts) {
    super(config, { apiKey: config.apiKey })
    this.client = new AzureOpenAI({
      endpoint: config.baseURL,
      apiKey: config.apiKey,
      deployment: config.deployment,
      apiVersion: config.apiVersion,
      dangerouslyAllowBrowser: true,
    }) 
  }

  getId(): string {
    return 'azure'
  }

  async getModels(): Promise<ModelOpenAI[]> {
    return [
      { id: 'default', object: 'model', created: 0, owned_by: 'system' },
    ]
  }

  protected setBaseURL() {
    // avoid override by super
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requiresPlainTextPayload(msg: Message): boolean {
    return true
  }
}
