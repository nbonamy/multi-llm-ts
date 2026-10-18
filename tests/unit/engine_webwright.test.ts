
import { vi, beforeEach, expect, test } from 'vitest'
import WebWright from '../../src/providers/webwright'
import Message from '../../src/models/message'
import { loadWebWrightModels, loadModels } from '../../src/llm'
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
          { id: 'wren-r1', object: 'model', created: 1, owned_by: 'webwright', context_length: 200000 },
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
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i] }, finish_reason: 'none' }] }
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

test('WebWright Load Chat Models', async () => {
  const models = await loadWebWrightModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'wren-r1', name: 'Wren R1', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: true, caching: true } },
  ])
  expect(await loadModels('webwright', config)).toStrictEqual(models)
})

test('WebWright Basic', () => {
  const webwright = new WebWright(config)
  expect(webwright.getName()).toBe('webwright')
  expect(webwright.getId()).toBe('webwright')
  expect(webwright.client.apiKey).toBe('123')
  expect(webwright.client.baseURL).toBe('https://webwright.ai/v1')
})

test('WebWright baseURL override survives setBaseURL', () => {
  const webwright = new WebWright({ apiKey: '123', baseURL: 'https://proxy.example.com/v1' })
  expect(webwright.client.baseURL).toBe('https://proxy.example.com/v1')
})

test('WebWright getModels returns empty without an api key', async () => {
  const webwright = new WebWright({})
  expect(await webwright.getModels()).toStrictEqual([])
})

test('WebWright capabilities and support flags', () => {
  const webwright = new WebWright(config)
  const model = webwright.buildModel('wren-r1')
  expect(webwright.getModelCapabilities({ id: 'wren-r1', object: 'model', owned_by: 'webwright' })).toStrictEqual({ tools: true, vision: false, reasoning: true, caching: true })
  expect(webwright.modelSupportsStructuredOutput(model)).toBe(true)
  expect(webwright.modelSupportsReasoningEffort(model)).toBe(true)
})

test('WebWright isConfigured', () => {
  expect(WebWright.isConfigured({})).toBe(false)
  expect(WebWright.isConfigured(config)).toBe(true)
})

test('WebWright structured output is sent', async () => {
  const webwright = new WebWright(config)
  await webwright.stream(webwright.buildModel('wren-r1'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  const responseFormat = OpenAI.prototype.chat.completions.create.mock.calls[0][0].response_format
  expect(responseFormat.type).toBe('json_schema')
  expect(responseFormat.json_schema.name).toBe('test')
})
