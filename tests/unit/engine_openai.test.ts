
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI, { OpenAIStreamingContext } from '../../src/providers/openai'
import * as _openai from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { loadModels, loadOpenAIModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { z } from 'zod'

Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
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
            { id: 'gpt', type: 'chat', created: 1 },
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
          { id: 'sora-2', created: 17 },
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

              // first we yield tool call chunks for multiple tools
              if (!opts.model.startsWith('o1-')) {
                // First tool call: plugin1 with empty args (index 0)
                yield { choices: [{ delta: { tool_calls: [ { index: 0, id: '1', function: { name: 'plugin1', arguments: '[]' }} ] }, finish_reason: 'none' } ] }

                // Second tool call: plugin2 with args split across chunks (index 1)
                yield { choices: [{ delta: { tool_calls: [ { index: 1, id: '2', function: { name: 'plugin2', arguments: '[ "a' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { index: 1, id: '', function: { arguments: 'r' } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { index: 1, id: null, function: { arguments: 'g" ]' } }] }, finish_reason: 'none' } ] }

                // Finish reason to trigger processing of both accumulated tools
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
    { id: 'o13-model', name: 'o13-model', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: true, caching: false } },
    { id: 'o1-model', name: 'o1-model', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: true, caching: false } },
    { id: 'o1', name: 'o1', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: true, caching: false } },
    { id: 'gpt-model2', name: 'gpt-model2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'gpt-model1', name: 'gpt-model1', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'chatgpt-model', name: 'chatgpt-model', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'gpt-image-1', name: 'GPT Image', meta: expect.any(Object), capabilities: expect.any(Object) },
    { id: 'dall-e-model2', name: 'dall-e-model2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
    { id: 'dall-e-model1', name: 'dall-e-model1', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
  ])
  expect(models!.video).toStrictEqual([
    { id: 'sora-2', name: 'sora-2', meta: expect.any(Object), capabilities: expect.any(Object) },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'text-embedding-2', name: 'text-embedding-2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
    { id: 'text-embedding-1', name: 'text-embedding-1', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
  ])
  expect(models!.realtime).toStrictEqual([
    { id: 'realtime-model', name: 'realtime-model', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
  ])
  expect(models!.computer).toStrictEqual([
    { id: 'computer-use-preview', name: 'computer-use-preview', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
  ])
  expect(models!.tts).toStrictEqual([
    { id: 'chatgpt-tts', name: 'chatgpt-tts', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false, caching: false }  },
  ])
  expect(models!.stt).toStrictEqual([
    { id: 'transcribe-french', name: 'transcribe-french', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
    { id: 'whisper-english', name: 'whisper-english', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false }  },
  ])
  expect(await loadModels('openai', config)).toStrictEqual(models)
})

test('OpenAI together load models', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.together.xyz' })
  expect(models!.chat).toStrictEqual([
    { id: 'code', name: 'code', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'language', name: 'language', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'gpt', name: 'gpt', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'image', name: 'image', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'embedding', name: 'embedding', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
})

test('OpenAI compatibility mode', async () => {
  const models = await loadOpenAIModels({ baseURL: 'api.unknown.com' })
  expect(models!.chat).toStrictEqual([
    { id: 'embedding', name: 'embedding', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'image', name: 'image', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'code', name: 'code', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'language', name: 'language', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'gpt', name: 'gpt', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
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

test('OpenAI buildPayload with tool calls', async () => {
  const openai = new OpenAI(config)
  const message = new Message('assistant', 'text', undefined, [
    { id: 'tool1', function: 'plugin2', args: { param: 'value' }, result: { result: 'ok' } }
  ])
  expect(openai.buildPayload(openai.buildModel('gpt-3.5'), [ message ])).toStrictEqual([
    { role: 'assistant', content: 'text', tool_calls: [
      { id: 'tool1', type: 'function', function: { name: 'plugin2', arguments: JSON.stringify({ param: 'value' }) } }
    ] },
    { role: 'tool', tool_call_id: 'tool1', name: 'plugin2', content: '{"result":"ok"}' }
  ])
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
    toolHistory: [],
    currentRound: 0,
    responsesApi: false,
    reasoningContent: '',
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
      { role: 'assistant', content: '', tool_calls: [
        { id: '1', function: { name: 'plugin1', arguments: '[]' } },
      ] },
      { role: 'tool', content: '"result1"', name: 'plugin1', tool_call_id: '1' },
      { role: 'assistant', content: '', tool_calls: [
        { id: '2', function: { name: 'plugin2', arguments: '[ "arg" ]' } }
      ] },
      { role: 'tool', content: '"result2"', name: 'plugin2', tool_call_id: '2' }
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
  expect(Plugin1.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, [])
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])

  // Verify tool call sequence: preparing for both tools, then running, then completed
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'preparing', status: 'prep1', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'running', status: 'run1 with []', call: { params: [], result: undefined }, done: false })
  expect(toolCalls[3]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'completed', call: { params: [], result: 'result1' }, status: undefined, done: true })
  expect(toolCalls[4]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[5]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await openai.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('OpenAI stream tool choice option', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'none' } })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    tool_choice: 'none',
  }))
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'required' } })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
    tool_choice: 'required',
  }))
  const { stream, context } = await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'tool', name: 'plugin1' } })
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(3, expect.objectContaining({
    tool_choice: { type: 'function', function: { name: 'plugin1' } },
  }))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const chunk of stream) { for await (const msg of openai.nativeChunkToLlmChunk(chunk, context)) {/* empty */ } }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(4, expect.objectContaining({
    tool_choice: 'auto',
  }))
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

test('OpenAI verbosity', async () => {
  const openai = new OpenAI(config)
  await openai.stream(openai.buildModel('gpt-4.1'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { verbosity: 'low' })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[0][0].verbosity).toBeUndefined()
  await openai.stream(openai.buildModel('gpt-5'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { verbosity: 'low' })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[1][0].verbosity).toBe('low')
})

test('OpenAI structured output', async () => {
  const openai = new OpenAI(config)
  await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(_openai.default.prototype.chat.completions.create.mock.calls[0][0].response_format).toMatchObject({
    type: 'json_schema',
    json_schema: expect.any(Object),
  })
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

test('OpenAI streaming validation deny - yields canceled chunk', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Policy violation' }
  })

  const chunks: LlmChunk[] = []
  const context = {
    model: openai.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    responsesApi: false,
    reasoningContent: '',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Simulate tool_calls finish_reason
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  for await (const chunk of openai.nativeChunkToLlmChunk(toolCallChunk, context)) {
    chunks.push(chunk)
  }

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()

  const toolChunks = chunks.filter(c => c.type === 'tool')
  const canceledChunk = toolChunks.find(c => c.state === 'canceled')
  expect(canceledChunk).toBeDefined()
  expect(canceledChunk).toMatchObject({
    type: 'tool',
    state: 'canceled',
    done: true
  })
})

test('OpenAI streaming validation abort - yields tool_abort chunk', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  const chunks: LlmChunk[] = []
  const context = {
    model: openai.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    responsesApi: false,
    reasoningContent: '',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Simulate tool_calls finish_reason - abort throws, so we need to catch it
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  try {
    for await (const chunk of openai.nativeChunkToLlmChunk(toolCallChunk, context)) {
      chunks.push(chunk)
    }
  } catch (error: any) {
    // The error IS the tool_abort chunk
    chunks.push(error)
  }

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()

  const abortChunks = chunks.filter(c => c.type === 'tool_abort')
  expect(abortChunks.length).toBe(1)
  expect(abortChunks[0]).toMatchObject({
    type: 'tool_abort',
    name: 'plugin2',
    reason: {
      decision: 'abort',
      extra: { reason: 'Security violation' }
    }
  })
})

test('OpenAI chat validation deny - throws error', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  // Mock to return tool calls - use mockImplementationOnce to preserve the original mock
  vi.mocked(_openai.default.prototype.chat.completions.create).mockImplementationOnce(() => Promise.resolve({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'tool_1',
          type: 'function',
          function: { name: 'plugin2', arguments: '{}' }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  }) as any)

  await expect(
    openai.complete(openai.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
  ).rejects.toThrow('Tool execution was canceled')

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('OpenAI chat validation abort - throws LlmChunkToolAbort', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  // Mock to return tool calls - use mockImplementationOnce to preserve the original mock
  vi.mocked(_openai.default.prototype.chat.completions.create).mockImplementationOnce(() => Promise.resolve({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'tool_1',
          type: 'function',
          function: { name: 'plugin2', arguments: '{}' }
        }]
      },
      finish_reason: 'tool_calls'
    }]
  }) as any)

  try {
    await openai.complete(openai.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
    expect.fail('Should have thrown')
  } catch (error: any) {
    expect(validator).toHaveBeenCalled()
    expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
    expect(error).toMatchObject({
      type: 'tool_abort',
      name: 'plugin2',
      reason: {
        decision: 'abort',
        extra: { reason: 'Security violation' }
      }
    })
  }
})

test('OpenAI syncToolHistoryToThread updates thread from toolHistory', () => {
  const openai = new OpenAI(config)

  const context: OpenAIStreamingContext = {
    model: openai.buildModel('model'),
    thread: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ original: 'result' }) },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'test_tool', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_2', content: JSON.stringify({ original: 'result2' }) },
    ],
    opts: {},
    toolCalls: [],
    toolHistory: [
      { id: 'call_1', name: 'test_tool', args: {}, result: { modified: 'truncated' }, round: 0 },
      { id: 'call_2', name: 'test_tool', args: {}, result: { modified: 'truncated2' }, round: 1 },
    ],
    currentRound: 2,
    responsesApi: false,
    reasoningContent: '',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Call syncToolHistoryToThread
  openai.syncToolHistoryToThread(context)

  // Verify thread was updated
  const toolMessage1 = context.thread.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_1') as any
  const toolMessage2 = context.thread.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_2') as any

  expect(toolMessage1.content).toBe(JSON.stringify({ modified: 'truncated' }))
  expect(toolMessage2.content).toBe(JSON.stringify({ modified: 'truncated2' }))
})

test('OpenAI addHook and hook execution', async () => {
  const openai = new OpenAI(config)

  const hookCallback = vi.fn()
  const unsubscribe = openai.addHook('beforeToolCallsResponse', hookCallback)

  // Create a context
  const context: OpenAIStreamingContext = {
    model: openai.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: { data: 'original' }, round: 0 }],
    currentRound: 1,
    responsesApi: false,
    reasoningContent: '',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Call the hook manually (normally done by nativeChunkToLlmChunk)
  // @ts-expect-error accessing protected method for testing
  await openai.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).toHaveBeenCalledWith(context)

  // Test unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // @ts-expect-error accessing protected method for testing
  await openai.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).not.toHaveBeenCalled()
})

test('OpenAI hook modifies tool results before second API call', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())

  // Register hook that truncates tool results from previous rounds
  openai.addHook('beforeToolCallsResponse', (context) => {
    for (const entry of context.toolHistory) {
      if (entry.name === 'plugin1') {
        entry.result = '[truncated]'
      }
    }
  })

  const { stream, context } = await openai.stream(openai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream to trigger tool calls and hook
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of openai.nativeChunkToLlmChunk(chunk, context)) { /* empty */ }
  }

  // Verify the second API call has truncated tool results
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      { role: 'tool', content: '"[truncated]"', name: 'plugin1', tool_call_id: '1' },
      { role: 'tool', content: expect.not.stringContaining('[truncated]'), name: 'plugin2', tool_call_id: '2' }
    ])
  }))
})
