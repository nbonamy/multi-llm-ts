
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadLMStudioModels, loadModels } from '../../src/llm'
import Message from '../../src/models/message'
import LMStudio from '../../src/providers/lmstudio'
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
          {'id': 'llama-3.0', 'object': 'model', 'owned_by': 'lmstudio'},
          {'id': 'llama3.1', 'object': 'model', 'owned_by': 'lmstudio'},
          {'id': 'llama-3.2', 'object': 'model', 'owned_by': 'lmstudio'},
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

              // yield some reasoning
              const reasoning = 'reasoning'
              yield { choices: [{ delta: { content: '<think>', finish_reason: 'none' } }] }
              for (let i = 0; i < reasoning.length; i++) {
                yield { choices: [{ delta: { content: reasoning[i], finish_reason: 'none' } }] }
              }
              yield { choices: [{ delta: { content: '</think>', finish_reason: 'none' } }] }

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

test('LMStudio Load Chat Models', async () => {
  const models = await loadLMStudioModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'llama-3.0', name: 'Llama 3.0', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'llama3.1', name: 'Llama3.1', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'llama-3.2', name: 'Llama 3.2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.image).toStrictEqual([])
  expect(await loadModels('lmstudio', config)).toStrictEqual(models)
})

test('LMStudio Basic', async () => {
  const lmstudio = new LMStudio (config)
  expect(lmstudio.getName()).toBe('lmstudio')
  expect(lmstudio.client.baseURL).toBe('http://localhost:1234/v1')
})

test('LMStudio stream', async () => {
  const lmstudio = new LMStudio (config)
  lmstudio.addPlugin(new Plugin1())
  lmstudio.addPlugin(new Plugin2())
  lmstudio.addPlugin(new Plugin3())
  const { stream, context } = await lmstudio.stream(lmstudio.buildModel('llama-3.2'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'llama-3.2',
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
  }, {})
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let reasoning = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of lmstudio.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'reasoning') reasoning += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(reasoning).toBe('reasoning')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'llama-3.2' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await lmstudio.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('LMStudio stream without tools', async () => {
  const lmstudio = new LMStudio (config)
  const { stream } = await lmstudio.stream(lmstudio.buildModel('llama-3.2'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'llama-3.2',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  }, {})
  expect(stream).toBeDefined()
})

test('LMStudio structured output', async () => {
  const lmstudio = new LMStudio(config)
  await lmstudio.stream(lmstudio.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(OpenAI.prototype.chat.completions.create.mock.calls[0][0].response_format).toMatchObject({
    type: 'json_schema',
    json_schema: expect.any(Object),
  })
})
