
import { LlmChunk } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Anthropic from '../../src/providers/anthropic'
import * as _Anthropic from '@anthropic-ai/sdk'
import { MessageParam } from '@anthropic-ai/sdk/resources'
import { loadAnthropicModels } from '../../src/llm'
import { EngineConfig, Model } from '../../src/types/index.d'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@anthropic-ai/sdk', async() => {
  const Anthropic = vi.fn()
  Anthropic.prototype.apiKey = '123'
  Anthropic.prototype.models = {
    list: vi.fn(() => {
      return { data: [{ id: 'model', name: 'model' }] }
    })
  }
  Anthropic.prototype.messages = {
    create: vi.fn((opts) => {
      if (opts.stream) {
        return {
          async * [Symbol.asyncIterator]() {
            
            // first we yield tool call chunks
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 1, name: 'plugin2' } }
            yield { type: 'content_block_delta', delta: { partial_json: '[ "ar' }  }
            yield { type: 'content_block_delta', delta: { partial_json: 'g" ]' }  }
            yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }  }
            
            // now the text response
            const content = 'response'
            for (let i = 0; i < content.length; i++) {
              yield { type: 'content_block_delta', delta: { text: content[i] } }
            }
            yield { type: 'message_stop' }
          },
          controller: {
            abort: vi.fn()
          }
        }
      }
      else {
        return { content: [{ text: 'response' }] }
      }
    })
  }
  Anthropic.prototype.images = {
    generate: vi.fn(() => {
      return {
        data: [{ revised_prompt: 'revised_prompt', url: 'url', b64_json: 'b64_json' }]
      }
    })
  }
  return { default : Anthropic }
})

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('Anthropic Load Models', async () => {
  expect(await loadAnthropicModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-sonnet-latest', name: 'Claude 3 Sonnet' },
    { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
])
  expect(config.model.chat).toStrictEqual(models[0].id)
})

test('Anthropic Basic', async () => {
  const anthropic = new Anthropic(config)
  expect(anthropic.getName()).toBe('anthropic')
  expect(anthropic.isVisionModel('claude-3-5-sonnet-latest')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-sonnet-latest')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-opus-latest')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-haiku-20240307')).toBe(true)
})

test('Anthropic completion', async () => {
  const anthropic = new Anthropic(config)
  const response = await anthropic.complete([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Anthropic streamChunkToLlmChunk Text', async () => {
  const anthropic = new Anthropic(config)
  const streamChunk: any = {
    index: 0,
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'response' }
  }
  const llmChunk1 = await anthropic.streamChunkToLlmChunk(streamChunk, null)
  expect(llmChunk1).toStrictEqual({ text: 'response', done: false })
  streamChunk.type = 'message_stop'
  const llmChunk2 = await anthropic.streamChunkToLlmChunk(streamChunk, null)
  expect(llmChunk2).toStrictEqual({ text: '', done: true })
})

test('Anthropic stream', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1(config))
  anthropic.addPlugin(new Plugin2(config))
  anthropic.addPlugin(new Plugin3(config))
  const stream = await anthropic.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalled()
  expect(stream.controller).toBeDefined()
  let response = ''
  const eventCallback = vi.fn()
  for await (const streamChunk of stream) {
    const chunk: LlmChunk = await anthropic.streamChunkToLlmChunk(streamChunk, eventCallback)
    if (chunk) {
      if (chunk.done) break
      response += chunk.text
    }
  }
  expect(response).toBe('response')
  expect(eventCallback).toHaveBeenNthCalledWith(1, { type: 'tool', content: 'prep2' })
  expect(eventCallback).toHaveBeenNthCalledWith(2, { type: 'tool', content: 'run2' })
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(eventCallback).toHaveBeenNthCalledWith(3, { type: 'tool', content: null })
  expect(eventCallback).toHaveBeenNthCalledWith(4, { type: 'stream', content: expect.any(Object) })
  await anthropic.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('Anthropic image', async () => {
  const anthropic = new Anthropic(config)
  const response = await anthropic.image('image', null)
  expect(response).toBeNull()
})

test('Anthropic addImageToPayload', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attachFile(new Attachment('', 'image/png', 'image', true ))
  const payload: MessageParam = { role: 'user', content: null }
  anthropic.addImageToPayload(message, payload)
  expect(payload.content).toStrictEqual([
    { type: 'text', text: 'text' },
    { type: 'image', source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'image',
    }}
  ])
})
