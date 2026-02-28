
import LlmEngine from './engine'
import Message from './models/message'
import { Plugin } from './plugin'
import { ChatModel } from './types'
import { LlmChunk, LlmCompletionOpts, LlmResponse } from './types/llm'

export default class LlmModel {

  engine: LlmEngine
  model: string|ChatModel

  constructor(engine: LlmEngine, model: string|ChatModel) {
    this.engine = engine
    this.model = model
  }

  get plugins() {
    return this.engine.plugins
  }

  clearPlugins(): void {
    this.engine.clearPlugins()
  }

  addPlugin(plugin: Plugin): void {
    this.engine.addPlugin(plugin)
  }

  removePlugin(name: string): void {
    this.engine.removePlugin(name)
  }

  complete(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    return this.engine.complete(this.model, thread, opts)
  }

  async *generate(thread: Message[], opts?: LlmCompletionOpts): AsyncIterable<LlmChunk> {
    const stream = this.engine.generate(this.model, thread, opts)
    for await (const chunk of stream) {
      yield chunk
    }
  }

}