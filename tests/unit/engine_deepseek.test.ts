
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import DeepSeek from '../../src/providers/deepseek'
import Message from '../../src/models/message'
import OpenAI, { ClientOptions } from 'openai'
import { loadDeepSeekModels, loadModels } from '../../src/llm'
import { LlmChunk } from '../../src/types/llm'

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
          { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek'},
          { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek'},
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
              yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
              yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
              yield { choices: [{ finish_reason: 'stop' } ] }

              // yield some reasoning
              const reasoning = 'reasoning'
              for (let i = 0; i < reasoning.length; i++) {
                yield { choices: [{ delta: { content: null, reasoning_content: reasoning[i], finish_reason: null } }] }
              }
              
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

test('DeepSeek Load Chat Models', async () => {
  const models = await loadDeepSeekModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'deepseek-chat', name: 'DeepSeek Chat', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: true } },
  ])
  expect(await loadModels('deepseek', config)).toStrictEqual(models)
})

test('DeepSeek Basic', async () => {
  const deepseek = new DeepSeek(config)
  expect(deepseek.getName()).toBe('deepseek')
  expect(deepseek.client.apiKey).toBe('123')
  expect(deepseek.client.baseURL).toBe('https://api.deepseek.com/v1')
})

test('DeepSeek completion', async () => {
  const deepseek = new DeepSeek(config)
  const response = await deepseek.complete(deepseek.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8, reasoningEffort: 'high' })
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    temperature : 0.8
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response',
    toolCalls: [],
  })
})

test('DeepSeek stream', async () => {
  const deepseek = new DeepSeek(config)
  deepseek.addPlugin(new Plugin1())
  deepseek.addPlugin(new Plugin2())
  deepseek.addPlugin(new Plugin3())
  const { stream, context } = await deepseek.stream(deepseek.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, reasoningEffort: 'low' })
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    logprobs: true,
    top_logprobs: 4,
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let reasoning = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of deepseek.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'reasoning') reasoning += msg.text
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(reasoning).toBe('reasoning')
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await deepseek.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('DeepSeek stream without tools', async () => {
  const deepseek = new DeepSeek(config)
  const { stream } = await deepseek.stream(deepseek.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    top_p: 4,
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
})
