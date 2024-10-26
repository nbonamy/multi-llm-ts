/* eslint-disable @typescript-eslint/no-unused-vars */

import Message from '../../src/models/message'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmEventCallback, LlmResponse, LlmStream } from '../../src/types/llm.d'
import LlmEngine from '../../src/engine'
import RandomChunkStream from './stream'
import { EngineConfig } from 'types'

class LlmError extends Error {

  name: string
  status: number
  message: string

  constructor(name: string, status: number, message: string) {
    super()
    this.name = name
    this.status = status
    this.message = message
  }
}

export default class LlmMock extends LlmEngine {

  constructor(config: EngineConfig) {
    super(config)
  }

  getName(): string {
    return 'mock'
  }

  isVisionModel(model: string): boolean {
    return model == 'vision'
  }

  async getModels(): Promise<any[]> {
    return [
      { id: 'chat', name: 'Chat' },
      { id: 'image', name: 'Image' },
      { id: 'vision', name: 'Vision' }
    ]
  }

  async complete(thread: Message[], opts: LlmCompletionOpts): Promise<LlmResponse> {
    return {
      type: 'text',
      content: JSON.stringify([
        ...thread.map(m => { return { role: m.role, content: m.content }}),
        { role: 'assistant', content: 'Be kind. Don\'t mock me' }
      ])
    }
  }

  async stream(thread: Message[], opts: LlmCompletionOpts): Promise<LlmStream> {

    // errors
    if (thread[thread.length-1].content.includes('no api key')) {
      throw new LlmError('NoApiKeyError', 401, 'Missing apiKey')
    }
    if (thread[thread.length-1].content.includes('no credit')) {
      throw new LlmError('LowBalanceError', 400, 'Your balance is too low')
    }
    if (thread[thread.length-1].content.includes('quota')) {
      throw new LlmError('QuotaExceededError', 429, 'You have exceeded your quota')
    }

    // model: switch to vision if needed
    const model = this.selectModel(thread, opts?.model || this.getChatModel())

    // build payload
    const payload = this.buildPayload(thread, model)

    // now stream
    return new RandomChunkStream(JSON.stringify([
      ...thread.map(m => { return { role: m.role, content: m.content }}),
      { role: 'assistant', content: 'Be kind. Don\'t mock me' }
    ]))
  }

  async stop(stream: RandomChunkStream) {
    stream.destroy()
  }

  async streamChunkToLlmChunk(chunk: any, eventCallback: LlmEventCallback): Promise<LlmChunk|null> {
    if (chunk.toString('utf8') == '<DONE>') {
      return {
        text: null,
        done: true
      }
    } else {
      return {
        text: chunk?.toString('utf8'),
        done: chunk == null
      }
    }
  }

  addImageToPayload(message: Message, payload: LLmCompletionPayload) {
    payload.images = [ message.attachment.contents ]
  }

   
  async image(prompt: string, opts: LlmCompletionOpts): Promise<LlmResponse|null> {
    return {
      type: 'image',
      original_prompt: prompt,
      content: 'image_content'
    }
  }

}
