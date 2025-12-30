
import { vi, beforeEach, expect, test } from 'vitest'
import Cerebras from '../../src/providers/cerebras'
import Message from '../../src/models/message'
import { loadCerebrasModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import OpenAI, { ClientOptions } from 'openai'
import { z } from 'zod'

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
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {

              // yield some reasoning
              const reasoning = 'reasoning'
              yield { choices: [{ delta: { content: '<think>' }, finish_reason: null }] }
              for (let i = 0; i < reasoning.length; i++) {
                yield { choices: [{ delta: { content: reasoning[i] }, finish_reason: null }] }
              }
              yield { choices: [{ delta: { content: '</think>' }, finish_reason: null }] }

              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i] }, finish_reason: null }] }
              }
              yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
            },
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
    { id: 'llama-3.3-70b', name: 'Llama 3.3 70b', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'llama3.1-8b', name: 'Llama3.1 8b', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
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
  const { stream, context } = await cerebras.stream(cerebras.buildModel('model'), [
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
  }, {})

  let response = ''
  let reasoning = ''
  for await (const chunk of stream) {
    for await (const msg of cerebras.processNativeChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'reasoning') reasoning += msg.text || ''
    }
  }
  expect(response).toBe('response')
  expect(reasoning).toBe('reasoning')
})

test('Cerebras structured output', async () => {
  const cerebras = new Cerebras(config)
  await cerebras.stream(cerebras.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(OpenAI.prototype.chat.completions.create.mock.calls[0][0].response_format).toMatchObject({
    type: 'json_schema',
    json_schema: expect.any(Object),
  })
})

