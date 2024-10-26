
import { EngineConfig, Model } from '../../src/types/index.d'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import XAI from '../../src/providers/xai'
import Message from '../../src/models/message'
import * as _OpenAI from 'openai'
import { loadXAIModels } from '../../src/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: _OpenAI.ClientOptions) => {
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

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('xAI Load Chat Models', async () => {
  expect(await loadXAIModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'grok-beta', name: 'Grok Beta' },
  ])
  expect(config.model.chat).toStrictEqual(models[0].id)
})

test('xAI Basic', async () => {
  const xai = new XAI(config)
  expect(xai.getName()).toBe('xai')
  expect(xai.client.apiKey).toBe('123')
  expect(xai.client.baseURL).toBe('https://api.x.ai/v1')
  expect(xai.isVisionModel('grok-beta')).toBe(false)
})

test('xAI stream', async () => {
  const xai = new XAI(config)
  xai.addPlugin(new Plugin1(config))
  xai.addPlugin(new Plugin2(config))
  xai.addPlugin(new Plugin3(config))
  const stream = await xai.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(_OpenAI.default.prototype.chat.completions.create).toHaveBeenCalled()
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
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', text: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', text: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', done: true })
  await xai.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})
