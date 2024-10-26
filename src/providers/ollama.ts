
import { EngineConfig } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmEventCallback } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'

import { Ollama, ChatResponse, ProgressResponse } from 'ollama/dist/browser.cjs'

export default class extends LlmEngine {

  client: any

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static isConfigured = (engineConfig: EngineConfig): boolean => {
    return true
  }

  static isReady = (engineConfig: EngineConfig): boolean => {
    return engineConfig.models.chat.length > 0
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
