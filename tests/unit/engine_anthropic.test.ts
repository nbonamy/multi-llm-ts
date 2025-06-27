import { vi, beforeEach, expect, test } from 'vitest'
import { NamedPlugin, Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
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
        { id: 'claude-2.0', display_name: 'Claude 2.0', created_at: '0' },
        { id: 'claude-3-model-date', display_name: 'Claude Model 3', created_at: '1' },
        { id: 'claude-3-5-model-date', display_name: 'Claude Model 3.5', created_at: '2' },
        { id: 'claude-3-7-sonnet-date', display_name: 'Claude Model 3.7', created_at: '3' },
        { id: 'claude-model-4-date', display_name: 'Claude Model 4', created_at: '4' },
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
            yield { type: 'content_block_delta', delta: { type: 'citations_delta', citation: {
              cited_text: 'cited_text\n',
            } } }
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
  expect(models!.chat).toStrictEqual([
    { id: 'claude-model-4-date', name: 'Claude Model 4', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: true, caching: false } },
    { id: 'claude-3-7-sonnet-date', name: 'Claude Model 3.7', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: true, caching: true } },
    { id: 'claude-3-5-model-date', name: 'Claude Model 3.5', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
    { id: 'claude-3-model-date', name: 'Claude Model 3', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
    { id: 'claude-2.0', name: 'Claude 2.0', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(await loadModels('anthropic', config)).toStrictEqual(models)
})

test('Anthropic Basic', async () => {
  const anthropic = new Anthropic(config)
  expect(anthropic.getName()).toBe('anthropic')
})

test('Anthropic max tokens', async () => {
  const anthropic = new Anthropic(config)
  expect(anthropic.getMaxTokens('claude-opus-4-latest')).toBe(32000)
  expect(anthropic.getMaxTokens('claude-sonnet-4-latest')).toBe(64000)
  expect(anthropic.getMaxTokens('claude-3-7-sonnet-latest')).toBe(64000)
  expect(anthropic.getMaxTokens('claude-3-7-haiku-latest')).toBe(64000)
  expect(anthropic.getMaxTokens('claude-3-5-sonnet-latest')).toBe(8192)
  expect(anthropic.getMaxTokens('claude-3-5-haiku-latest')).toBe(8192)
  expect(anthropic.getMaxTokens('claude-3-sonnet-20240229')).toBe(4096)
  expect(anthropic.getMaxTokens('claude-3-opus-20240229')).toBe(4096)
  expect(anthropic.getMaxTokens('claude-3-haiku-20240307')).toBe(4096)
  expect(anthropic.getMaxTokens('computer-use')).toBe(8192)
})

test('Anthropic buildPayload text', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('document', 'text/plain'))
  message.attachments[0]!.title = 'title'
  message.attachments[0]!.context = 'context'
  expect(anthropic.buildPayload(anthropic.buildModel('claude'), [ message ])).toStrictEqual([ { role: 'user', content: [
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
  expect(anthropic.buildPayload(anthropic.buildModel('claude'), [ message ])).toStrictEqual([ { role: 'user', content: [{ type: 'text', text: 'text' }] }])
  expect(anthropic.buildPayload(anthropic.buildModel('claude-3-5-sonnet-latest'), [ message ])).toStrictEqual([ { role: 'user', content: [
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
  const response = await anthropic.complete(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] } ],
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
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [],
    opts: {},
    firstTextBlockStart: true,
    usage: { prompt_tokens: 0, completion_tokens: 0 }
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
  const { stream, context } = await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, {
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] } ],
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
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, {
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: [ { type: 'tool_use', id: 1, name: 'plugin2', input: [ 'arg' ], } ] },
      { role: 'user', content: [ { type: 'tool_result', tool_use_id: 1, content: '"result2"' } ] },
    ],
    tools: expect.any(Array),
    tool_choice: { type: 'auto' },
    top_k: 4,
    stream: true,
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('cited_text\nresponse')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await anthropic.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('Anthropic stream tool choice option', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'none'} })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: { type: 'none' },
  }))
  await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'required'} })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: { type: 'any' },
  }))
  const { stream, context } = await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'tool', name: 'plugin1' } })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: { type: 'tool', name: 'plugin1' },
  }))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const chunk of stream) { for await (const msg of anthropic.nativeChunkToLlmChunk(chunk, context)) {/* empty */ } }
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: { type: 'auto' },
  }))
})

test('Anthropic stream with tools caching', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new NamedPlugin('plugin1', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin2', 'not cached'))
  anthropic.addPlugin(new NamedPlugin('plugin3', 'not in cache'))
  anthropic.addPlugin(new NamedPlugin('plugin4', 'will be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin5', 'hopefully cached'))
  anthropic.addPlugin(new NamedPlugin('plugin6', 'whatever'))
  anthropic.addPlugin(new NamedPlugin('plugin7', 'must be cached'))
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-date'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, caching: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt', }] } ],
    tools: [
      { name: 'plugin1', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin2', description: expect.any(String), input_schema: expect.any(Object), cache_control: undefined },
      { name: 'plugin3', description: expect.any(String), input_schema: expect.any(Object), cache_control: undefined },
      { name: 'plugin4', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin5', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin6', description: expect.any(String), input_schema: expect.any(Object), cache_control: undefined },
      { name: 'plugin7', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
    ]
  }))
})

test('Anthropic stream with system caching', async () => {
  const anthropic = new Anthropic(config)
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-date'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, caching: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    system: [ { type: 'text', text: 'instruction', cache_control: { type: 'ephemeral' } } ],
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt', }] } ],
  }))
})

test('Anthropic stream with tools and system caching 1', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new NamedPlugin('plugin1', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin2', 'not cached'))
  anthropic.addPlugin(new NamedPlugin('plugin3', 'not in cache'))
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-date'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, caching: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    system: [ { type: 'text', text: 'instruction', cache_control: { type: 'ephemeral' } } ],
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt', }] } ],
    tools: [
      { name: 'plugin1', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin2', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin3', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
    ]
  }))
})

test('Anthropic stream with tools and system caching 2', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new NamedPlugin('plugin1', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin2', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin3', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin4', 'not in cache'))
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-date'), [
    new Message('system', 'will be cached'),
    new Message('user', 'prompt'),
  ], { top_k: 4, caching: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    system: [ { type: 'text', text: 'will be cached', cache_control: { type: 'ephemeral' } } ],
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt', }] } ],
    tools: [
      { name: 'plugin1', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin2', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin3', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin4', description: expect.any(String), input_schema: expect.any(Object), cache_control: undefined },
    ]
  }))
})

test('Anthropic stream with tools and system caching 3', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new NamedPlugin('plugin1', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin2', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin3', 'should be cached'))
  anthropic.addPlugin(new NamedPlugin('plugin4', 'should be cached'))
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-date'), [
    new Message('system', 'not cached'),
    new Message('user', 'prompt'),
  ], { top_k: 4, caching: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
    system: 'not cached',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt', }] } ],
    tools: [
      { name: 'plugin1', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin2', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin3', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
      { name: 'plugin4', description: expect.any(String), input_schema: expect.any(Object), cache_control: { type: 'ephemeral' } },
    ]
  }))
})

test('Anthropic stream tools disabled', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, tools: false })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] } ],
    top_k: 4,
    stream: true,
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Anthropic stream without tools', async () => {
  const anthropic = new Anthropic(config)
  const { stream } = await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledWith({
    max_tokens: 4096,
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, ],
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
})

test('Anthropic thinking', async () => {
  const anthropic = new Anthropic(config)
  await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoning: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(1, {
    model: 'model',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, ],
    max_tokens: 4096,
    stream: true,
  })
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-thinking'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoning: true })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, {
    model: 'claude-3-7-sonnet-thinking',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, ],
    max_tokens: 64000,
    thinking: {
      type: 'enabled',
      budget_tokens: 32000,
    },
    temperature: 1,
    stream: true,
  })
})
