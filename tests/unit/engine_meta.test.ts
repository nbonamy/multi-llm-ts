
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadMetaModels, loadModels } from '../../src/llm'
import Message from '../../src/models/message'
import Meta from '../../src/providers/meta'
import OpenAI, { ClientOptions } from 'openai'
import { LlmChunk } from '../../src/types/llm'
import { z } from 'zod'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return {
        data: [
          {'id': 'Llama-3.3-8B-Instruct', name: 'Llama-3.3-8B-Instruct', 'created': 1, 'object': 'model', 'owned_by': 'Meta'},
          {'id': 'Llama-4-Maverick-17B-128E-Instruct-FP8', 'name': 'Llama-4-Maverick-17B-128E-Instruct-FP8', 'created': 3, 'object': 'model', 'owned_by': 'Meta'},
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
              
              // first we yield tool call chunks
              yield { choices: [{ delta: { tool_calls: [ { id: 0, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
              yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'tool_calls' } ] }
              
              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i], finish_reason: 'none' } }] }
              }
              yield { choices: [{ delta: { content: '', finish_reason: 'done' } }] }
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

test('Meta Load Chat Models', async () => {
  const models = await loadMetaModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'Llama-4-Maverick-17B-128E-Instruct-FP8', name: 'Llama 4 Maverick 17B 128E Instruct FP8', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
    { id: 'Llama-3.3-8B-Instruct', name: 'Llama 3.3 8B Instruct', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.image).toStrictEqual([])
  expect(await loadModels('meta', config)).toStrictEqual(models)
})

test('Meta Basic', async () => {
  const meta = new Meta(config)
  expect(meta.getName()).toBe('meta')
  expect(meta.client.apiKey).toBe('123')
  expect(meta.client.baseURL).toBe('https://api.llama.com/compat/v1/')
})

test('Meta stream', async () => {
  const meta = new Meta(config)
  meta.addPlugin(new Plugin1())
  meta.addPlugin(new Plugin2())
  meta.addPlugin(new Plugin3())
  const { stream, context } = await meta.stream(meta.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of meta.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await meta.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('Meta stream without tools', async () => {
  const meta = new Meta(config)
  const { stream } = await meta.stream(meta.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
})

test('Meta structured output', async () => {
  const meta = new Meta(config)
  await meta.stream(meta.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(OpenAI.prototype.chat.completions.create.mock.calls[0][0].response_format).toBeUndefined()
})
