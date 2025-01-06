
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadModels, loadXAIModels } from '../../src/llm'
import Message from '../../src/models/message'
import XAI from '../../src/providers/xai'
import OpenAI from 'openai'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: OpenAI.prototype.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
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
  config = {
    apiKey: '123',
  }
})

test('xAI Load Chat Models', async () => {
  const models = await loadXAIModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'grok-beta', name: 'Grok 2' },
    { id: 'grok-vision-beta', name: 'Grok Vision' },
  ])
  expect(await loadModels('xai', config)).toStrictEqual(models)
})

test('xAI Basic', async () => {
  const xai = new XAI(config)
  expect(xai.getName()).toBe('xai')
  expect(xai.client.apiKey).toBe('123')
  expect(xai.client.baseURL).toBe('https://api.x.ai/v1')
})

test('xAI Vision Models', async () => {
  const xai = new XAI(config)
  expect(xai.isVisionModel('grok-beta')).toBe(false)
  expect(xai.isVisionModel('grok-vision-beta')).toBe(true)
})

test('xAI stream', async () => {
  const xai = new XAI(config)
  xai.addPlugin(new Plugin1())
  xai.addPlugin(new Plugin2())
  xai.addPlugin(new Plugin3())
  const stream = await xai.stream('model', [
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
  const toolCalls = []
  for await (const chunk of stream) {
    for await (const msg of xai.nativeChunkToLlmChunk(chunk)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await xai.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('xAI stream without tools', async () => {
  const xai = new XAI(config)
  const stream = await xai.stream('model', [
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
