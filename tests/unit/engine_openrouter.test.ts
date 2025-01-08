
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadModels, loadOpenRouterModels } from '../../src/llm'
import OpenRouter from '../../src/providers/openrouter'
import Message from '../../src/models/message'
import OpenAI from 'openai'
import { LlmChunk } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: OpenAI.prototype.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return {
        data: [
          { id: 'chat1', name: 'chat1', architecture: { modality: 'text-->text' } },
          { id: 'chat2', name: 'chat2', architecture: { modality: 'text+image-->text' } },
          { id: 'image', name: 'image', architecture: { modality: 'text-->image' } },
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
  config = {
    apiKey: '123',
  }
})

test('OpenRouter Load Chat Models', async () => {
  const models = await loadOpenRouterModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'chat1', name: 'chat1', meta: { id: 'chat1', name: 'chat1', architecture: { modality: 'text-->text' } } },
    { id: 'chat2', name: 'chat2', meta: { id: 'chat2', name: 'chat2', architecture: { modality: 'text+image-->text' } } },
  ])
  expect(models.image).toStrictEqual([
    { id: 'image', name: 'image', meta: { id: 'image', name: 'image', architecture: { modality: 'text-->image' } } },
  ])
  expect(await loadModels('openrouter', config)).toStrictEqual(models)
})

test('OpenRouter Basic', async () => {
  const openrouter = new OpenRouter(config)
  expect(openrouter.getName()).toBe('openrouter')
  expect(openrouter.client.apiKey).toBe('123')
  expect(openrouter.client.baseURL).toBe('https://openrouter.ai/api/v1')
})

test('OpenRouter Vision Models', async () => {
  const openrouter = new OpenRouter(config)
  await openrouter.initVisionModels()
  expect(openrouter.isVisionModel('chat1')).toBe(false)
  expect(openrouter.isVisionModel('chat2')).toBe(true)
  expect(openrouter.isVisionModel('image')).toBe(false)
})

test('OpenRouter stream', async () => {
  const openrouter = new OpenRouter(config)
  openrouter.addPlugin(new Plugin1())
  openrouter.addPlugin(new Plugin2())
  openrouter.addPlugin(new Plugin3())
  const stream = await openrouter.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
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
    for await (const msg of openrouter.nativeChunkToLlmChunk(chunk)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await openrouter.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('OpenRouter stream without tools', async () => {
  const openrouter = new OpenRouter(config)
  const stream = await openrouter.stream('model', [
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
  expect(stream).toBeDefined()
})
