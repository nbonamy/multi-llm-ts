import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Anthropic, { AnthropicStreamingContext } from '../../src/providers/anthropic'
import { loadAnthropicModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import * as _Anthropic from '@anthropic-ai/sdk'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@anthropic-ai/sdk', async() => {
  const Anthropic = vi.fn()
  Anthropic.prototype.apiKey = '123'
  Anthropic.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model1', display_name: 'model1' },
        { id: 'model2', display_name: 'model2' },
      ] }
    })
  }
  Anthropic.prototype.messages = {
    create: vi.fn((opts) => {
      if (opts.stream) {
        return {
          async * [Symbol.asyncIterator]() {
            
            // first we yield tool call chunks
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 1, name: 'plugin2' } }
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '[ "ar' }  }
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'g" ]' }  }
            yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }  }
            
            // now the text response
            const content = 'response'
            for (let i = 0; i < content.length; i++) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: content[i] } }
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
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Anthropic Load Models', async () => {
  const models = await loadAnthropicModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'model1', name: 'model1', meta: expect.any(Object) },
    { id: 'model2', name: 'model2', meta: expect.any(Object) },
  ])
  expect(await loadModels('anthropic', config)).toStrictEqual(models)
})

test('Anthropic Basic', async () => {
  const anthropic = new Anthropic(config)
  expect(anthropic.getName()).toBe('anthropic')
})

test('Anthropic Vision Model', async () => {
  const anthropic = new Anthropic(config)
  expect(anthropic.isVisionModel('claude-3-5-sonnet-latest')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-5-opus-latest')).toBe(false)
  expect(anthropic.isVisionModel('claude-3-5-haiku-latest')).toBe(false)
  expect(anthropic.isVisionModel('claude-3-sonnet-20240229')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-opus-20240229')).toBe(true)
  expect(anthropic.isVisionModel('claude-3-haiku-20240307')).toBe(true)
})


test('Anthropic buildPayload text', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('document', 'text/plain'))
  message.attachment!.title = 'title'
  message.attachment!.context = 'context'
  expect(anthropic.buildPayload('claude', [ message ])).toStrictEqual([ { role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'document', source: {
      type: 'text',
      media_type: 'text/plain',
      data: 'document',
    }, title: 'title', context: 'context' }
  ]}])
})

test('Anthropic build payload image', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(anthropic.buildPayload('claude', [ message ])).toStrictEqual([ { role: 'user', content: 'text' }])
  expect(anthropic.buildPayload('claude-3-5-sonnet-latest', [ message ])).toStrictEqual([ { role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'image', source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'image',
    }}
  ]}])
})

test('Anthropic completion', async () => {
  const anthropic = new Anthropic(config)
  const response = await anthropic.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' } ],
    temperature: 0.8,
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response',
    toolCalls: [],
  })
})

test('Anthropic nativeChunkToLlmChunk Text', async () => {
  const anthropic = new Anthropic(config)
  const streamChunk: any = {
    index: 0,
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'response' }
  }
  const context: AnthropicStreamingContext = {
    model: 'model',
    system: 'instruction',
    thread: [],
    opts: {},
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  }
  for await (const llmChunk of anthropic.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.delta.text = null
  streamChunk.type = 'message_stop'
  for await (const llmChunk of anthropic.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Anthropic stream', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  const { stream, context } = await anthropic.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, {
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' } ],
    tools: expect.any(Array),
    tool_choice: { type: 'auto' },
    top_k: 4,
    stream: true,
  })
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg: LlmChunkContent|null = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of anthropic.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, {
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [
      { role: 'user', content: 'prompt' },
      { role: 'assistant', content: [ { type: 'tool_use', id: 1, name: 'plugin2', input: [ 'arg' ], } ] },
      { role: 'user', content: [ { type: 'tool_result', tool_use_id: 1, content: '"result2"' } ] },
    ],
    tools: expect.any(Array),
    tool_choice: { type: 'auto' },
    top_k: 4,
    stream: true,
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await anthropic.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('Anthropic stream tools disabled', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  await anthropic.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, tools: false })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' } ],
    top_k: 4,
    stream: true,
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Anthropic stream without tools', async () => {
  const anthropic = new Anthropic(config)
  const { stream } = await anthropic.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' }, ],
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
})

test('Anthropic thinking', async () => {
  const anthropic = new Anthropic(config)
  await anthropic.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoning: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, {
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' }, ],
    max_tokens: 4096,
    stream: true,
  })
  await anthropic.stream('claude-3-7-sonnet-thinking', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoning: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, {
    model: 'claude-3-7-sonnet-thinking',
    system: 'instruction',
    messages: [ { role: 'user', content: 'prompt' }, ],
    max_tokens: 4096,
    thinking: {
      type: 'enabled',
      budget_tokens: 2048,
    },
    temperature: 1,
    stream: true,
  })
})
