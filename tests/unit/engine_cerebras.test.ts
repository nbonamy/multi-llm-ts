
import { vi, beforeEach, expect, test } from 'vitest'
import Cerebras from '../../src/providers/cerebras'
import Message from '../../src/models/message'
import { loadCerebrasModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import OpenAI, { ClientOptions } from 'openai'

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return {
        data: [
          { 'id': 'llama3.1-8b', 'object': 'model', 'created': 1, 'owned_by': 'Meta' },
          { 'id': 'llama-3.3-70b', 'object': 'model', 'created': 2, 'owned_by': 'Meta' }
        ]
      }
    })
  }
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn()
    }
  }
  return { default : OpenAI }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Cerebras Load Chat Models', async () => {
  const models = await loadCerebrasModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70b', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'llama3.1-8b', name: 'Llama3.1 8b', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
  expect(await loadModels('cerebras', config)).toStrictEqual(models)
})

test('Cerebras Basic', async () => {
  const cerebras = new Cerebras(config)
  expect(cerebras.getName()).toBe('cerebras')
  expect(cerebras.client.apiKey).toBe('123')
  expect(cerebras.client.baseURL).toBe('https://api.cerebras.ai/v1')
})

test('Cerebras stream', async () => {
  const cerebras = new Cerebras(config)
  /*const response = */await cerebras.stream(cerebras.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4, top_k: 4})
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    top_p: 4,
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
})
