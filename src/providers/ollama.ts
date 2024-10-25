
import { EngineConfig, Message } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmEventCallback } from 'types/llm.d'
import LlmEngine from '../engine'
import { Ollama } from 'ollama/dist/browser.mjs'
import { ChatResponse, ProgressResponse } from 'ollama'

export const getChatModels = [
  { id: 'llama3.2:latest', name: 'Llama 3.2' },
  { id: 'llama3.1:latest', name: 'Llama 3.1' },
  { id: 'mistral-large:latest', name: 'Mistral Large 2' },
  { id: 'phi3.5:latest', name: 'Phi 3.5' },
  { id: 'llava-llama3:latest', name: 'LLaVa Llama 3' }
]

export const getEmbeddingModels = [
  { id: 'all-minilm', name: 'all-minilm' },
  { id: 'nomic-embed-text', name: 'nomic-embed-text' },
  { id: 'mxbai-embed-large', name: 'mxbai-embed-large' },
]

export default class extends LlmEngine {

  client: any

  static isConfigured = (engineConfig: EngineConfig): boolean => {
    return true
  }

  constructor(config: EngineConfig) {
    super(config)
    this.client = new Ollama({
      host: config.baseURL,
    })
  }

  getName(): string {
    return 'ollama'
  }

  getVisionModels(): string[] {
    return ['llava-llama3:latest', 'llava:latest', '*llava*']
  }

  async getModels(): Promise<any[]> {
    try {
      const response = await this.client.list()
      return response.models
    } catch (error) {
      console.error('Error listing models:', error);
    }
  }

  async getModelInfo(model: string): Promise<any> {
    try {
      return await this.client.show({ model: model })
    } catch (error) {
      console.error('Error listing models:', error);
      return
    }
  }

  async pullModel(model: string): Promise<AsyncGenerator<ProgressResponse>> {
    try {
      return this.client.pull({
        model: model,
        stream: true
      })
    } catch (error) {
      console.error('Error pulling models:', error);
      return null
    }
  }

  async complete(thread: Message[], opts: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    const model = opts?.model || this.config.model.chat
    console.log(`[ollama] prompting model ${model}`)
    const response = await this.client.chat({
      model: model,
      messages: this.buildPayload(thread, model),
      stream: false
    });

    // return an object
    return {
      type: 'text',
      content: response.message.content
    }
  }

  async stream(thread: Message[], opts: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    const model = this.selectModel(thread, opts?.model || this.getChatModel())
  
    // call
    console.log(`[ollama] prompting model ${model}`)
    const stream = this.client.chat({
      model: model,
      messages: this.buildPayload(thread, model),
      stream: true,
    })

    // done
    return stream

  }

  async stop() {
    await this.client.abort()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async streamChunkToLlmChunk(chunk: ChatResponse, eventCallback: LlmEventCallback): Promise<LlmChunk|null> {
    return {
      text: chunk.message.content,
      done: chunk.done
    }
  }

  addImageToPayload(message: Message, payload: LLmCompletionPayload) {
    payload.images = [ message.attachment.contents ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async image(prompt: string, opts: LlmCompletionOpts): Promise<LlmResponse|null> {
    return null    
  }
}
