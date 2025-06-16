
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
            { id: 'chat', type: 'chat', created: 1 },
            { id: 'language', type: 'language', created: 2 },
            { id: 'code', type: 'code', created: 3 },
            { id: 'image', type: 'image', created: 4 },
            { id: 'embedding', type: 'embedding', created: 5 },
          ]
        }
      }
      return {
        data: [
          { id: 'chatgpt-model', created: 1 },
          { id: 'gpt-model2', created: 3 },
          { id: 'gpt-model1', created: 2 },
          { id: 'o1', created: 4 },
          { id: 'o1-model', created: 5 },
          { id: 'o13-model', created: 6 },
          { id: 'realtime-model', created: 7 },
          { id: 'computer-use-preview', created: 8 },
          { id: 'chatgpt-tts', created: 9 },
          { id: 'moderation-model', created: 10 },
          { id: 'whisper-english', created: 11 },
          { id: 'transcribe-french', created: 12 },
          { id: 'dall-e-model2', created: 14 },
          { id: 'dall-e-model1', created: 13 },
          { id: 'text-embedding-1', created: 15 },
          { id: 'text-embedding-2', created: 16 },
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
                yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "a' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { id: '', function: { arguments: [ 'r' ] } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { id: null, function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
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
  expect(models!.chat).toStrictEqual([
    { id: 'o13-model', name: 'o13-model', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: true, reasoning: true } },
    { id: 'o1-model', name: 'o1-model', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: true, reasoning: true } },
    { id: 'o1', name: 'o1', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: true, reasoning: true } },
    { id: 'gpt-model2', name: 'gpt-model2', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'gpt-model1', name: 'gpt-model1', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'chatgpt-model', name: 'chatgpt-model', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: false, vision: false, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'gpt-image-1', name: 'GPT Image', meta: expect.any(Object), capabilities: expect.any(Object) },
    { id: 'dall-e-model2', name: 'dall-e-model2', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
    { id: 'dall-e-model1', name: 'dall-e-model1', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'text-embedding-2', name: 'text-embedding-2', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
    { id: 'text-embedding-1', name: 'text-embedding-1', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
  ])
  expect(models!.realtime).toStrictEqual([
    { id: 'realtime-model', name: 'realtime-model', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
  ])
  expect(models!.computer).toStrictEqual([
    { id: 'computer-use-preview', name: 'computer-use-preview', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
  ])
  expect(models!.tts).toStrictEqual([
    { id: 'chatgpt-tts', name: 'chatgpt-tts', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: false, vision: false, reasoning: false }  },
  ])
  expect(models!.stt).toStrictEqual([
    { id: 'transcribe-french', name: 'transcribe-french', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
    { id: 'whisper-english', name: 'whisper-english', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false }  },
  ])
  expect(await loadModels('openai', config)).toStrictEqual(models)
})

test('OpenAI together load models', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.together.xyz' })
  expect(models!.chat).toStrictEqual([
    { id: 'code', name: 'code', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'language', name: 'language', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'chat', name: 'chat', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'image', name: 'image', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'embedding', name: 'embedding', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
})

test('OpenAI compatibility mode', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.unknown.com' })
  expect(models!.chat).toStrictEqual([
    { id: 'embedding', name: 'embedding', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'image', name: 'image', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'code', name: 'code', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'language', name: 'language', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
    { id: 'chat', name: 'chat', meta: expect.any(Object), capabilities: { responses: expect.any(Boolean), tools: true, vision: false, reasoning: false } },
  ])
})

test('OpenAI Basic', async () => {
  const openai = new OpenAI(config)
  expect(openai.getName()).toBe('openai')
  expect(openai.client.apiKey).toBe('123')
  expect(openai.client.baseURL).toBe('https://api.openai.com/v1')
})

test('OpenAI system prompt for most models', async () => {
  const openai = new OpenAI(config)
  const payload = openai.buildPayload(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(payload).toStrictEqual([
    { role: 'system', content: 'instruction' },
    { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
  ])
})

test('OpenAI no system prompt for most o1 models', async () => {
  const openai = new OpenAI(config)
  const payload = openai.buildPayload(openai.buildModel('o1-mini'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(payload).toStrictEqual([
    { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
  ])
})

test('OpenAI buildPayload', async () => {
  const openai = new OpenAI(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-3.5'), [ message ])).toStrictEqual([{ role: 'user', content: [{ type: 'text', text: 'text' }] }])
  expect(openai.buildPayload(openai.buildModel('gpt-4o'), [ message ])).toStrictEqual([{ role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,image' } }
  ]}])
})

test('OpenAI buildPayload in compatibility mode', async () => {
  const openai = new OpenAI({ baseURL: 'api.unknown.com' })
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  message.attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-3.5'), [ message ])).toStrictEqual([{ role: 'user', content: 'text\n\nattachment' }])
  expect(openai.buildPayload(openai.buildModel('gpt-4o'), [ message ])).toStrictEqual([{ role: 'user', content: [
    { type: 'text', text: 'text\n\nattachment' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,image' } }
  ]}])
})

test('OpenAI completion', async () => {
  const openai = new OpenAI(config)
  const response = await openai.complete(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8, tools: false })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
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

test('OpenAI nativeChunkToLlmChunk Text', async () => {
  const openai = new OpenAI(config)
  const streamChunk: ChatCompletionChunk = {
    id: 'id',
    created: 1,
    model: 'model',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'response' }, finish_reason: null }],
  }
  const context = {
    model: openai.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }
  for await (const llmChunk of openai.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.choices[0].delta.content = null
  streamChunk.choices[0].finish_reason = 'stop'
  for await (const llmChunk of openai.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('OpenAI stream', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin3())
  const { stream, context } = await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(1, {
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
  let lastMsg:LlmChunkContent|null  = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of openai.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: '', tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "arg" ]' } } ] },
      { role: 'tool', content: '"result2"', name: 'plugin2', tool_call_id: 1 }
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
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await openai.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('OpenAI stream tools disabled', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin3())
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, tools: false })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    logprobs: true,
    top_logprobs: 4,
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('OpenAI stream no tools for o1', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin3())
  const { stream } = await openai.stream(openai.buildModel('o1-mini'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { maxTokens: 200, temperature: 1.0, top_k: 4, top_p: 4 })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'o1-mini',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
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
  const { stream } = await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
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

test('OpenAI reasoning effort', async () => {
  const openai = new OpenAI(config)
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoningEffort: 'low' })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[0][0].reasoning_effort).toBeUndefined()
  await openai.stream(openai.buildModel('o1'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoningEffort: 'low' })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[1][0].reasoning_effort).toBe('low')
})

test('OpenAI custom options', async () => {
  const openai = new OpenAI(config)
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { customOpts: { mirostat: true } })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[0][0].mirostat).toBe(true)
})
