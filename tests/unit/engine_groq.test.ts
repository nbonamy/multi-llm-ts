
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Groq from '../../src/providers/groq'
import { ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { loadGroqModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index.d'

vi.mock('groq-sdk', async() => {
  const Groq = vi.fn()
  Groq.prototype.apiKey = '123'
  Groq.prototype.listModels = vi.fn(() => {
    return { data: [
      { id: 'model2', name: 'model2' },
      { id: 'model1', name: 'model1' },
    ] }
  })
  Groq.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            controller: {
              abort: vi.fn()
            }
          }
        }
        else {
          return { choices: [{ message: { content: 'response' } }] }
        }
      })
    }
  }
  return { default : Groq }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
})

test('Groq Load Models', async () => {
  const models = await loadGroqModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
    { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision (Preview)' },
    { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision (Preview)' },
    { id: 'llama-3.2-3b-preview', name: 'Llama 3.2 3B Text (Preview)' },
    { id: 'llama-3.2-1b-preview', name: 'Llama 3.2 1B Text (Preview)' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8b' },
    { id: 'llama3-70b-8192', name: 'Llama 3 70b' },
    { id: 'llama3-8b-8192', name: 'Llama 3 8b' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7b' },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9b' },
    { id: 'gemma-7b-it', name: 'Gemma 7b' },

  ])
})

test('Groq Basic', async () => {
  const groq = new Groq(config)
  expect(groq.getName()).toBe('groq')
})

test('Groq Vision Models', async () => {
  const groq = new Groq(config)
  const models = await groq.getModels()
  const vision = [ 'llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview' ]
  for (const model of models) {
    expect(groq.isVisionModel(model.id)).toBe(vision.includes(model.id))
  }
})

test('Groq  completion', async () => {
  const groq = new Groq(config)
  const response = await groq.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Groq  stream', async () => {
  const groq = new Groq(config)
  const response = await groq.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(response.controller).toBeDefined()
  await groq.stop(response)
})

test('Groq nativeChunkToLlmChunk Text', async () => {
  const groq = new Groq(config)
  const streamChunk: ChatCompletionChunk = {
    id: '123', model: 'model1', created: null, object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'response' }, finish_reason: null }],
  }
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.choices[0].finish_reason = 'stop'
  streamChunk.choices[0].delta.content = null
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})
