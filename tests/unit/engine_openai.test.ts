
import { LLmCompletionPayload } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI from '../../src/providers/openai'
import * as _OpenAI from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { loadOpenAIModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index.d'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: _OpenAI.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return {
        data: [
          { id: 'gpt-model2' },
          { id: 'gpt-model1' },
          { id: 'dall-e-model2' },
          { id: 'dall-e-model1' },
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
              if (!opts.model.startsWith('o1-')) {
                yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
              }
              
              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i] }, finish_reason: 'none' }] }
              }
              yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
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
  OpenAI.prototype.images = {
    generate: vi.fn(() => {
      return {
        data: [{ revised_prompt: 'revised_prompt', url: 'url', b64_json: 'b64_json' }]
      }
    })
  }
  return { default: OpenAI }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks();
  config = {
    apiKey: '123',
  }
})

test('OpenAI Load Chat Models', async () => {
  const models = await loadOpenAIModels(config)
  expect(_OpenAI.default.prototype.models.list).toHaveBeenCalled()
  expect(models.chat).toStrictEqual([
    { id: 'gpt-model1', name: 'gpt-model1', meta: { id: 'gpt-model1' } },
    { id: 'gpt-model2', name: 'gpt-model2', meta: { id: 'gpt-model2' } },
  ])
})

test('OpenAI Load Image Models', async () => {
  const models = await loadOpenAIModels(config)
  expect(_OpenAI.default.prototype.models.list).toHaveBeenCalled()
  expect(models.image).toStrictEqual([
    { id: 'dall-e-model1', name: 'dall-e-model1', meta: { id: 'dall-e-model1' } },
    { id: 'dall-e-model2', name: 'dall-e-model2', meta: { id: 'dall-e-model2' } },
  ])
})

test('OpenAI Basic', async () => {
  const openai = new OpenAI(config)
  expect(openai.getName()).toBe('openai')
  expect(openai.client.apiKey).toBe('123')
  expect(openai.client.baseURL).toBe('https://api.openai.com/v1')
})

test('OpenAI Vision Model', async () => {
  const openai = new OpenAI(config)
  expect(openai.isVisionModel('gpt-3.5')).toBe(false)
  expect(openai.isVisionModel('gpt-4-turbo')).toBe(false)
  expect(openai.isVisionModel('gpt-vision')).toBe(true)
  expect(openai.isVisionModel('gpt-4o')).toBe(true)
  expect(openai.isVisionModel('gpt-4o-mini')).toBe(false)
  expect(openai.isVisionModel('o1-preview')).toBe(false)
  expect(openai.isVisionModel('o1-mini')).toBe(false)
})

test('OpenAI system prompt for most models', async () => {
  const openai = new OpenAI(config)
  // @ts-expect-error testing private method
  const payload = openai.buildPayload('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(payload).toStrictEqual([
    { role: 'system', content: 'instruction' },
    { role: 'user', content: 'prompt' },
  ])
})

test('OpenAI no system prompt for most o1 models', async () => {
  const openai = new OpenAI(config)
  // @ts-expect-error testing private method
  const payload = openai.buildPayload('o1-mini', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(payload).toStrictEqual([
    { role: 'user', content: 'prompt' },
  ])
})

test('OpenAI completion', async () => {
  const openai = new OpenAI(config)
  const response = await openai.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_OpenAI.default.prototype.chat.completions.create).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('OpenAI nativeChunkToLlmChunk Text', async () => {
  const openai = new OpenAI(config)
  const streamChunk: ChatCompletionChunk = {
    id: 'id',
    created: 1,
    model: 'model',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'response' }, finish_reason: null }],
  }
  for await (const llmChunk of openai.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.choices[0].delta.content = null
  streamChunk.choices[0].finish_reason = 'stop'
  for await (const llmChunk of openai.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('OpenAI stream', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin3())
  const stream = await openai.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_OpenAI.default.prototype.chat.completions.create).toHaveBeenCalledWith({
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
  let lastMsg = null
  const toolCalls = []
  for await (const chunk of stream) {
    for await (const msg of openai.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await openai.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('OpenAI stream no tools for o1', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin3())
  const stream = await openai.stream('o1-mini', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_OpenAI.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'o1-mini',
    messages: [ { role: 'user', content: 'prompt' } ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
})

test('OpenAI stream without tools', async () => {
  const openai = new OpenAI(config)
  const stream = await openai.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_OpenAI.default.prototype.chat.completions.create).toHaveBeenCalledWith({
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

test('OpenAI addAttachmentToPayload', async () => {
  const openai = new OpenAI(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  const payload: LLmCompletionPayload = { role: 'user', content: '' }
  openai.addAttachmentToPayload(message, payload)
  expect(payload.content).toStrictEqual([
    { type: 'text', text: 'text' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,image' } }
  ])
})
