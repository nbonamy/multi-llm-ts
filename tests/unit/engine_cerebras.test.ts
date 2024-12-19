
import { vi, beforeEach, expect, test } from 'vitest'
import Cerebras from '../../src/providers/cerebras'
import Message from '../../src/models/message'
import OpenAI, { ClientOptions } from 'openai'
import { loadCerebrasModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index.d'

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn()
    }
  }
  return { default : OpenAI }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
})

test('Cerebras Load Chat Models', async () => {
  const models = await loadCerebrasModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'llama3.1-8b', name: 'Llama 3.1 8b' },
    { id: 'llama3.1-70b', name: 'Llama 3.1 70b' },
  ])
})

test('Cerebras Basic', async () => {
  const cerebras = new Cerebras(config)
  expect(cerebras.getName()).toBe('cerebras')
  expect(cerebras.client.apiKey).toBe('123')
  expect(cerebras.client.baseURL).toBe('https://api.cerebras.ai/v1')
})

test('Cerebras Vision Models', async () => {
  const cerebras = new Cerebras(config)
  expect(cerebras.isVisionModel('llama3.1-8b')).toBe(false)
  expect(cerebras.isVisionModel('llama3.1-70b')).toBe(false)
})

test('Cerebras stream', async () => {
  const cerebras = new Cerebras(config)
  /*const response = */await cerebras.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
})
