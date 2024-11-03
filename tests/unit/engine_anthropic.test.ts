
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Anthropic from '../../src/providers/anthropic'
import * as _Anthropic from '@anthropic-ai/sdk'
import { MessageParam } from '@anthropic-ai/sdk/resources'
import { loadAnthropicModels } from '../../src/llm'
import { EngineCreateOpts, Model } from '../../src/types/index.d'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'

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

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
})

test('Anthropic Load Models', async () => {
  const models = await loadAnthropicModels(config)
  expect(models.chat.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-sonnet-latest', name: 'Claude 3 Sonnet' },
    { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' },
    { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
  ])
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
  const response = await anthropic.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Anthropic nativeChunkToLlmChunk Text', async () => {
  const anthropic = new Anthropic(config)
  const streamChunk: any = {
    index: 0,
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'response' }
  }
  for await (const llmChunk of anthropic.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.delta.text = null
  streamChunk.type = 'message_stop'
  for await (const llmChunk of anthropic.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Anthropic stream', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  const stream = await anthropic.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalled()
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg: LlmChunkContent|null = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of anthropic.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await anthropic.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('Anthropic addImageToPayload', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
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
