
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI from '../../src/providers/openai'
import * as _openai from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { loadModels, loadOpenAIModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      if (OpenAI.prototype.baseURL == 'api.together.xyz' || OpenAI.prototype.baseURL == 'api.unknown.com') {
        return {
          data: [
            { id: 'chat', type: 'chat' },
            { id: 'language', type: 'language' },
            { id: 'code', type: 'code' },
            { id: 'image', type: 'image' },
            { id: 'embedding', type: 'embedding' },
          ]
        }
      }
      return {
        data: [
          { id: 'chatgpt-model' },
          { id: 'gpt-model2' },
          { id: 'gpt-model1' },
          { id: 'o1' },
          { id: 'o1-model' },
          { id: 'o13-model' },
          { id: 'op-model' },
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

test('OpenAI Load Models', async () => {
  const models = await loadOpenAIModels(config)
  expect(_openai.default.prototype.models.list).toHaveBeenCalled()
  expect(models.chat).toStrictEqual([
    { id: 'chatgpt-model', name: 'chatgpt-model', meta: { id: 'chatgpt-model' } },
    { id: 'gpt-model1', name: 'gpt-model1', meta: { id: 'gpt-model1' } },
    { id: 'gpt-model2', name: 'gpt-model2', meta: { id: 'gpt-model2' } },
    { id: 'o1', name: 'o1', meta: { id: 'o1' } },
    { id: 'o1-model', name: 'o1-model', meta: { id: 'o1-model' } },
    { id: 'o13-model', name: 'o13-model', meta: { id: 'o13-model' } },
  ])
  expect(models.image).toStrictEqual([
    { id: 'dall-e-model1', name: 'dall-e-model1', meta: { id: 'dall-e-model1' } },
    { id: 'dall-e-model2', name: 'dall-e-model2', meta: { id: 'dall-e-model2' } },
  ])
  expect(await loadModels('openai', config)).toStrictEqual(models)
})

test('OpenAI together load models', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.together.xyz' })
  expect(models.chat).toStrictEqual([
    { id: 'chat', name: 'chat', meta: { id: 'chat', type: 'chat' } },
    { id: 'code', name: 'code', meta: { id: 'code', type: 'code' } },
    { id: 'language', name: 'language', meta: { id: 'language', type: 'language' } },
  ])
  expect(models.image).toStrictEqual([
    { id: 'image', name: 'image', meta: { id: 'image', type: 'image' } },
  ])
  expect(models.embedding).toStrictEqual([
    { id: 'embedding', name: 'embedding', meta: { id: 'embedding', type: 'embedding' } },
  ])
})

test('OpenAI compatibility mode', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.unknown.com' })
  expect(models.chat).toStrictEqual([
    { id: 'chat', name: 'chat', meta: { id: 'chat', type: 'chat' } },
    { id: 'code', name: 'code', meta: { id: 'code', type: 'code' } },
    { id: 'embedding', name: 'embedding', meta: { id: 'embedding', type: 'embedding' } },
    { id: 'image', name: 'image', meta: { id: 'image', type: 'image' } },
    { id: 'language', name: 'language', meta: { id: 'language', type: 'language' } },
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

test('OpenAI buildPayload', async () => {
  const openai = new OpenAI(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload('gpt-3.5', [ message ])).toStrictEqual([{ role: 'user', content: 'text' }])
  expect(openai.buildPayload('gpt-4o', [ message ])).toStrictEqual([{ role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,image' } }
  ]}])
})

test('OpenAI completion', async () => {
  const openai = new OpenAI(config)
  const response = await openai.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    temperature : 0.8
  })
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
  ], { top_k: 4 })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
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
  let lastMsg:LlmChunkContent|null  = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of openai.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg?.done).toBe(true)
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
  ], { maxTokens: 200, temperature: 1.0, top_k: 4, top_p: 4 })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'o1-mini',
    messages: [ { role: 'user', content: 'prompt' } ],
    max_completion_tokens: 200,
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
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
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

test('OpenAI reasoning effort', async () => {
  const openai = new OpenAI(config)
  await openai.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoningEffort: 'low' })
  expect(_openai.default.prototype.chat.completions.create.mock.calls[0][0].reasoning_effort).toBeUndefined()
  await openai.stream('o1', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoningEffort: 'low' })
  expect(_openai.default.prototype.chat.completions.create.mock.calls[1][0].reasoning_effort).toBe('low')
})
