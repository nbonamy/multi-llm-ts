
import { vi, beforeEach, expect, test } from 'vitest'
import Cerebras from '../../src/providers/cerebras'
import Message from '../../src/models/message'
import OpenAI, { ClientOptions } from 'openai'
import { loadCerebrasModels } from '../../src/llm'
import { EngineConfig, Model } from '../../src/types/index.d'

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

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('Cerebras Load Chat Models', async () => {
  expect(await loadCerebrasModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'llama3.1-8b', name: 'Llama 3.1 8b' },
    { id: 'llama3.1-70b', name: 'Llama 3.1 70b' },
  ])
  expect(config.model.chat).toStrictEqual(models[0].id)
})

test('Cerebras Basic', async () => {
  const cerebras = new Cerebras(config)
  expect(cerebras.getName()).toBe('cerebras')
  expect(cerebras.client.apiKey).toBe('123')
  expect(cerebras.client.baseURL).toBe('https://api.cerebras.ai/v1')
  expect(cerebras.isVisionModel('llama3.1-8b')).toBe(false)
  expect(cerebras.isVisionModel('llama3.1-70b')).toBe(false)
})

test('Cerebras stream', async () => {
  const cerebras = new Cerebras(config)
  /*const response = */await cerebras.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalled()
  expect(OpenAI.prototype.chat.completions.create.mock.calls[0][0].tools).toBeNull()
  expect(OpenAI.prototype.chat.completions.create.mock.calls[0][0].tool_choice).toBeNull()
})
