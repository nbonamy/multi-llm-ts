
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Groq from '../../src/providers/groq'
import { ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { loadGroqModels } from '../../src/llm'
import { EngineConfig, Model } from '../../src/types/index.d'

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

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('Groq Load Models', async () => {
  expect(await loadGroqModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'llama-3.2-1b-preview', name: 'Llama 3.2 1B Text (Preview)' },
    { id: 'llama-3.2-3b-preview', name: 'Llama 3.2 3B Text (Preview)' },
    { id: 'llama-3.2-11b-text-preview', name: 'Llama 3.2 11B Text (Preview)' },
    { id: 'llama-3.2-90b-text-preview', name: 'Llama 3.2 90B Text (Preview)' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8b', },
    { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70b', },
    { id: 'llama3-8b-8192', name: 'Llama 3 8b', },
    { id: 'llama3-70b-8192', name: 'Llama 3 70b', },
    { id: 'llava-v1.5-7b-4096-preview', name: 'LLaVa v1.5 7b', },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7b', },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9b', },
    { id: 'gemma-7b-it', name: 'Gemma 7b', }
  ])
  expect(config.model.chat).toStrictEqual(models[0].id)
})

test('Groq Basic', async () => {
  const groq = new Groq(config)
  expect(groq.getName()).toBe('groq')
  expect(groq.isVisionModel('llama2-70b-4096')).toBe(false)
  expect(groq.isVisionModel('llama3-70b-8192')).toBe(false)
})

test('Groq  completion', async () => {
  const groq = new Groq(config)
  const response = await groq.complete([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Groq  stream', async () => {
  const groq = new Groq(config)
  const response = await groq.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
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
