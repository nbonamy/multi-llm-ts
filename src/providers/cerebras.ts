
import { EngineConfig } from 'types/index.d'
import OpenAI from './openai'

export default class extends OpenAI {

  static isConfigured = (engineConfig: EngineConfig): boolean => {
    return engineConfig?.apiKey?.length > 0
  }
  
  constructor(config: EngineConfig) {
    super(config, {
      apiKey: config.apiKey,
      baseURL: 'https://api.cerebras.ai/v1',
    })
  }

  getName(): string {
    return 'cerebras'
  }

  getVisionModels(): string[] {
    return []
  }
  
  async getModels(): Promise<any[]> {
    // need an api key
    if (!this.client.apiKey) {
      return null
    }

    // do it
    return [
      { id: 'llama3.1-8b', name: 'Llama 3.1 8b' },
      { id: 'llama3.1-70b', name: 'Llama 3.1 70b' },
    ]

  }

  protected setBaseURL() {
    // avoid override by super
  }

  async getAvailableTools(): Promise<any[]> {
    return []
  }

}
