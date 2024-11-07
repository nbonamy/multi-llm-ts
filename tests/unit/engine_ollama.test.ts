
import { LLmCompletionPayload } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadOllamaModels } from '../../src/llm'
import { EngineCreateOpts, Model } from '../../src/types/index.d'

vi.mock('ollama/dist/browser.cjs', async() => {
  const Ollama = vi.fn()
  Ollama.prototype.list = vi.fn(() => {
    return { models: [
      { model: 'model2', name: 'model2' },
      { model: 'model1', name: 'model1' },
    ] }
  })
  Ollama.prototype.show = vi.fn(() => {
    return {
      details: { family: 'llm' },
      model_info: {}
    }
  })
  Ollama.prototype.chat = vi.fn((opts) => {
    if (opts.stream) {
      return {
        controller: {
          abort: vi.fn()
        }
      }
    }
    else {
      return { message: { content: 'response' } }
    }
  })
  Ollama.prototype.abort = vi.fn()
  return { Ollama: Ollama }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
})

test('Ollama Load Models', async () => {
  const models = await loadOllamaModels(config)
  expect(models.chat.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'model1', name: 'model1' },
    { id: 'model2', name: 'model2' },
  ])
})

test('Ollama Basic', async () => {
  const ollama = new Ollama(config)
  expect(ollama.getName()).toBe('ollama')
  expect(ollama.isVisionModel('llava:latest')).toBe(true)
  expect(ollama.isVisionModel('llama2:latest')).toBe(false)
})

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Ollama stream', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalled()
  expect(response.controller).toBeDefined()
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama addImageToPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  const payload: LLmCompletionPayload = { role: 'user', content: message }
  ollama.addImageToPayload(message, payload)
  expect(payload.images).toStrictEqual([ 'image' ])
})

test('Ollama nativeChunkToLlmChunk Text', async () => {
  const ollama = new Ollama(config)
  const streamChunk: any = {
    message: { content: 'response'},
    done: false
  }
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.done = true
  streamChunk.message.content = null
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Build payload with image attachment', async () => {
  const ollama = new Ollama(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(ollama.buildPayload('llama', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
  ])
  expect(ollama.buildPayload('llama3.2-vision:11b', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1', images: [ 'image' ] },
  ])
})
