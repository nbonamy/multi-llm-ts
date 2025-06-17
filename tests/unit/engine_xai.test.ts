
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadModels, loadXAIModels } from '../../src/llm'
import Message from '../../src/models/message'
import XAI from '../../src/providers/xai'
import OpenAI, { ClientOptions } from 'openai'
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
          {'id': 'grok-1', 'created': 1, 'object': 'model', 'owned_by': 'xai'},
          {'id': 'grok-2', 'created': 2, 'object': 'model', 'owned_by': 'xai'},
          {'id': 'grok-2-vision', 'created': 4, 'object': 'model', 'owned_by': 'xai'},
          {'id': 'grok-2-image', 'created': 3, 'object': 'model', 'owned_by': 'xai'},
          {'id': 'grok-3', 'created': 5, 'object': 'model', 'owned_by': 'xai'},
          {'id': 'grok-3-mini-fast', 'created': 6, 'object': 'model', 'owned_by': 'xai'},
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

test('xAI Load Chat Models', async () => {
  const models = await loadXAIModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'grok-3-mini-fast', name: 'Grok 3 Mini Fast', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: true } },
    { id: 'grok-3', name: 'Grok 3', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'grok-2-vision', name: 'Grok 2 Vision', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: false, vision: true, reasoning: false } },
    { id: 'grok-2', name: 'Grok 2', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'grok-1', name: 'Grok 1', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'grok-2-image', name: 'Grok 2 Image', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
  expect(await loadModels('xai', config)).toStrictEqual(models)
})

test('xAI Basic', async () => {
  const xai = new XAI(config)
  expect(xai.getName()).toBe('xai')
  expect(xai.client.apiKey).toBe('123')
  expect(xai.client.baseURL).toBe('https://api.x.ai/v1')
})

test('xAI stream', async () => {
  const xai = new XAI(config)
  xai.addPlugin(new Plugin1())
  xai.addPlugin(new Plugin2())
  xai.addPlugin(new Plugin3())
  const { stream, context } = await xai.stream(xai.buildModel('model'), [
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
    for await (const msg of xai.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await xai.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('xAI stream without tools', async () => {
  const xai = new XAI(config)
  const { stream } = await xai.stream(xai.buildModel('model'), [
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
