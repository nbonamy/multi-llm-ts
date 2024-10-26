
import { LLmCompletionPayload } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadOllamaModels } from '../../src/llm'
import { EngineConfig, Model } from '../../src/types/index.d'

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

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('Ollama Load Models', async () => {
  expect(await loadOllamaModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'model1', name: 'model1' },
    { id: 'model2', name: 'model2' },
  ])
  expect(config.model.chat).toStrictEqual(models[0].name)
})

test('Ollama Basic', async () => {
  const ollama = new Ollama(config)
  expect(ollama.getName()).toBe('ollama')
  expect(ollama.isVisionModel('llava:latest')).toBe(true)
  expect(ollama.isVisionModel('llama2:latest')).toBe(false)
})

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Ollama stream', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalled()
  expect(response.controller).toBeDefined()
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama image', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.image('image', null)
  expect(response).toBeNull()
})

test('Ollama addImageToPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attachFile(new Attachment('', 'image/png', 'image', true ))
  const payload: LLmCompletionPayload = { role: 'user', content: message }
  ollama.addImageToPayload(message, payload)
  expect(payload.images).toStrictEqual([ 'image' ])
})

test('Ollama streamChunkToLlmChunk Text', async () => {
  const ollama = new Ollama(config)
  const streamChunk: any = {
    message: { content: 'response'},
    done: false
  }
  const llmChunk1 = await ollama.streamChunkToLlmChunk(streamChunk, null)
  expect(llmChunk1).toStrictEqual({ text: 'response', done: false })
  streamChunk.done = true
  const llmChunk2 = await ollama.streamChunkToLlmChunk(streamChunk, null)
  expect(llmChunk2).toStrictEqual({ text: 'response', done: true })
})
