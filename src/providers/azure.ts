
import { EngineCreateOpts, Model } from '../types/index'
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

  getName(): string {
    return 'azure'
  }

  async getModels(): Promise<Model[]> {
    return [
      { id: 'default', name: 'default' },
    ]
  }

  protected setBaseURL() {
    // avoid override by super
  }

}
