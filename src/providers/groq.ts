
import { EngineConfig } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmEventCallback } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'

import Groq from 'groq-sdk'
import { ChatCompletionMessageParam, ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { Stream } from 'groq-sdk/lib/streaming'

export default class extends LlmEngine {

  client: Groq

  constructor(config: EngineConfig) {
    super(config)
    this.client = new Groq({
      apiKey: config.apiKey || '',
      dangerouslyAllowBrowser: true,
    })
  }

  getName(): string {
    return 'groq'
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
      { id: 'llama-3.2-1b-preview', name: 'Llama 3.2 1B Text (Preview)' },
      { id: 'llama-3.2-3b-preview', name: 'Llama 3.2 3B Text (Preview)' },
      { id: 'llama-3.2-11b-text-preview', name: 'Llama 3.2 11B Text (Preview)' },
      { id: 'llama-3.2-90b-text-preview', name: 'Llama 3.2 90B Text (Preview)' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8b' },
      { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70b' },
      { id: 'llama3-8b-8192', name: 'Llama 3 8b' },
      { id: 'llama3-70b-8192', name: 'Llama 3 70b' },
      { id: 'llava-v1.5-7b-4096-preview', name: 'LLaVa v1.5 7b' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7b' },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9b' },
      { id: 'gemma-7b-it', name: 'Gemma 7b' },
    ]
  }

  async complete(thread: Message[], opts: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    const model = opts?.model || this.config.model.chat
    console.log(`[Groq] prompting model ${model}`)
    const response = await this.client.chat.completions.create({
      model: model,
      messages: this.buildPayload(thread, model),
    });

    // return an object
    return {
      type: 'text',
      content: response.choices[0].message.content
    }
  }

  async stream(thread: Message[], opts: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    const model = this.selectModel(thread, opts?.model || this.getChatModel())
  
    // call
    console.log(`[Groq] prompting model ${model}`)
    const stream = this.client.chat.completions.create({
      model: model,
      messages: this.buildPayload(thread, model),
      stream: true,
    })

    // done
    return stream

  }

  async stop(stream: Stream<any>) {
    stream.controller.abort()
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async streamChunkToLlmChunk(chunk: ChatCompletionChunk, eventCallback: LlmEventCallback): Promise<LlmChunk|null> {
    if (chunk.choices[0].finish_reason == 'stop') {
      return { text: '', done: true }
    } else {
      return {
        text: chunk.choices[0].delta.content,
        done: false
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(message: Message, payload: LLmCompletionPayload) {
  }

  buildPayload(thread: Message[], model: string): Array<ChatCompletionMessageParam> {
    const payload: LLmCompletionPayload[] = super.buildPayload(thread, model)
    return payload.map((payload): ChatCompletionMessageParam => {
      return {
        role: payload.role,
        content: payload.content
      }
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async image(prompt: string, opts: LlmCompletionOpts): Promise<LlmResponse|null> {
    return null    
  }
}
