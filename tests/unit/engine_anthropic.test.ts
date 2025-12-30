import { vi, beforeEach, expect, test } from 'vitest'
import { NamedPlugin, Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Anthropic, { AnthropicStreamingContext } from '../../src/providers/anthropic'
import { loadAnthropicModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import * as _Anthropic from '@anthropic-ai/sdk'

Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
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

            // first tool call: plugin1
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 1, name: 'plugin1' } }
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '[]' }  }
            yield { type: 'content_block_stop' }

            // second tool call: plugin2 (split across chunks)
            yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 2, name: 'plugin2' } }
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '[ "ar' }  }
            yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'g" ]' }  }
            yield { type: 'content_block_stop' }

            // stop_reason triggers processing of both accumulated tools
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
  expect(models!.image).toStrictEqual([])
  expect(models!.video).toStrictEqual([])
  expect(models!.embedding).toStrictEqual([])
  expect(models!.computer).toStrictEqual([
    { id: 'computer-use', name: 'Computer Use', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
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

test('Anthropic buildAnthropicPayload text', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('document', 'text/plain'))
  message.attachments[0]!.title = 'title'
  message.attachments[0]!.context = 'context'
  expect(anthropic.buildAnthropicPayload(anthropic.buildModel('claude'), [ message ])).toStrictEqual([ { role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'document', source: {
      type: 'text',
      media_type: 'text/plain',
      data: 'document',
    }, title: 'title', context: 'context' }
  ]}])
})

test('Anthropic buildAnthropicPayload image', async () => {
  const anthropic = new Anthropic(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(anthropic.buildAnthropicPayload(anthropic.buildModel('claude'), [ message ])).toStrictEqual([ { role: 'user', content: [{ type: 'text', text: 'text' }] }])
  expect(anthropic.buildAnthropicPayload(anthropic.buildModel('claude-3-5-sonnet-latest'), [ message ])).toStrictEqual([ { role: 'user', content: [
    { type: 'text', text: 'text' },
    { type: 'image', source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'image',
    }}
  ]}])
})

test('Anthropic buildAnthropicPayload with tool calls', async () => {
  const anthropic = new Anthropic(config)
  const user = new Message('user', 'text')
  const assistant = new Message('assistant', 'text', undefined, [
    { id: 'tool1', function: 'plugin1', args: { param: 'value' }, result: { result: 'ok' } },
    { id: 'tool2', function: 'plugin2', args: { param: 'value' }, result: { result: 'ok' } }
  ])
  expect(anthropic.buildAnthropicPayload(anthropic.buildModel('claude'), [ user, assistant ])).toStrictEqual([
    { role: 'user', content: [{ type: 'text', text: 'text' }] },
    { role: 'assistant', content: [{
      type: 'tool_use',
      id: 'tool1',
      name: 'plugin1',
      input: { param: 'value' },
    }, {
      type: 'tool_use',
      id: 'tool2',
      name: 'plugin2',
      input: { param: 'value' },
    }]},
    { role: 'user', content: [{
      type: 'tool_result',
      tool_use_id: 'tool1',
      content: '{"result":"ok"}'
    }, {
      type: 'tool_result',
      tool_use_id: 'tool2',
      content: '{"result":"ok"}'
    }]},
    { role: 'assistant', content: 'text' },
  ])
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

test('Anthropic processNativeChunk Text', async () => {
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
    toolCalls: [],
    opts: {},
    firstTextBlockStart: true,
    toolHistory: [],
    currentRound: 0,
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 },
    usage: { prompt_tokens: 0, completion_tokens: 0 }
  }
  for await (const llmChunk of anthropic.processNativeChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.delta.text = null
  streamChunk.type = 'message_stop'
  for await (const llmChunk of anthropic.processNativeChunk(streamChunk, context)) {
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
    for await (const msg of anthropic.processNativeChunk(chunk, context)) {
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
      { role: 'assistant', content: [
        { type: 'tool_use', id: 1, name: 'plugin1', input: [], },
        { type: 'tool_use', id: 2, name: 'plugin2', input: [ 'arg' ], }
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 1, content: '"result1"' },
        { type: 'tool_result', tool_use_id: 2, content: '"result2"' }
      ] },
    ],
    tools: expect.any(Array),
    tool_choice: { type: 'auto' },
    top_k: 4,
    stream: true,
  })
  // Verify messages.create was only called twice (initial + after tool execution)
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenCalledTimes(2)
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('cited_text\nresponse')
  expect(Plugin1.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, [])
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])

  // Verify tool call sequence: preparing for both tools, then running, then completed
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin1', state: 'preparing', status: 'prep1', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 2, name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin1', state: 'running', status: 'run1 with []', call: { params: [], result: undefined }, done: false })
  expect(toolCalls[3]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin1', state: 'completed', call: { params: [], result: 'result1' }, status: undefined, done: true })
  expect(toolCalls[4]).toStrictEqual({ type: 'tool', id: 2, name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[5]).toStrictEqual({ type: 'tool', id: 2, name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
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
  for await (const chunk of stream) { for await (const msg of anthropic.processNativeChunk(chunk, context)) {/* empty */ } }
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
  ])
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, {
    model: 'claude-3-7-sonnet-thinking',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, ],
    max_tokens: 64000,
    thinking: {
      type: 'enabled',
      budget_tokens: 1024,
    },
    temperature: 1,
    stream: true,
  })
  await anthropic.stream(anthropic.buildModel('claude-3-7-sonnet-thinking'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { reasoning: false })
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(3, {
    model: 'claude-3-7-sonnet-thinking',
    system: 'instruction',
    messages: [ { role: 'user', content: [{ type: 'text', text: 'prompt' }] }, ],
    max_tokens: 64000,
    stream: true,
  })
})

test('Anthropic streaming validation deny - yields canceled chunk', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Policy violation' }
  })

  const chunks: LlmChunk[] = []
  const context: AnthropicStreamingContext = {
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [],
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: '' }],
    toolHistory: [],
    currentRound: 0,
    opts: { toolExecutionValidation: validator },
    firstTextBlockStart: true,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 }
  }

  // Simulate tool_use stop
  const toolCallChunk = { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
  for await (const chunk of anthropic.processNativeChunk(toolCallChunk as any, context)) {
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

test('Anthropic streaming validation abort - yields tool_abort chunk', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  const chunks: LlmChunk[] = []
  const context: AnthropicStreamingContext = {
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [],
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: '' }],
    toolHistory: [],
    currentRound: 0,
    opts: { toolExecutionValidation: validator },
    firstTextBlockStart: true,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 }
  }

  // Simulate tool_use stop - abort throws, so we need to catch it
  const toolCallChunk = { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
  try {
    for await (const chunk of anthropic.processNativeChunk(toolCallChunk as any, context)) {
      chunks.push(chunk)
    }
  } catch (error: any) {
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

test('Anthropic chat validation deny - throws error', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_Anthropic.default.prototype.messages.create).mockImplementationOnce(() => Promise.resolve({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: '1', name: 'plugin2', input: {} }]
  }) as any)

  await expect(
    anthropic.complete(anthropic.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
  ).rejects.toThrow('Tool execution was canceled')

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Anthropic chat validation abort - throws LlmChunkToolAbort', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_Anthropic.default.prototype.messages.create).mockImplementationOnce(() => Promise.resolve({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: '1', name: 'plugin2', input: {} }]
  }) as any)

  try {
    await anthropic.complete(anthropic.buildModel('model'), [
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

test('Anthropic syncToolHistoryToThread updates thread from toolHistory', () => {
  const anthropic = new Anthropic(config)

  // Anthropic uses nested tool_result format
  const context: AnthropicStreamingContext = {
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'test_tool', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: JSON.stringify({ original: 'result' }) }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2', name: 'test_tool', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: JSON.stringify({ original: 'result2' }) }] },
    ],
    opts: {},
    toolCalls: [],
    toolHistory: [
      { id: 'call_1', name: 'test_tool', args: {}, result: { modified: 'truncated' }, round: 0 },
      { id: 'call_2', name: 'test_tool', args: {}, result: { modified: 'truncated2' }, round: 1 },
    ],
    currentRound: 2,
    firstTextBlockStart: true,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Call syncToolHistoryToThread
  anthropic.syncToolHistoryToThread(context)

  // Find the tool_result blocks and verify they were updated
  const toolResult1 = (context.thread[2] as any).content.find((c: any) => c.type === 'tool_result' && c.tool_use_id === 'call_1')
  const toolResult2 = (context.thread[4] as any).content.find((c: any) => c.type === 'tool_result' && c.tool_use_id === 'call_2')

  expect(toolResult1.content).toBe(JSON.stringify({ modified: 'truncated' }))
  expect(toolResult2.content).toBe(JSON.stringify({ modified: 'truncated2' }))
})

test('Anthropic addHook and hook execution', async () => {
  const anthropic = new Anthropic(config)

  const hookCallback = vi.fn()
  const unsubscribe = anthropic.addHook('beforeToolCallsResponse', hookCallback)

  const context: AnthropicStreamingContext = {
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [],
    opts: {},
    toolCalls: [],
    toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: { data: 'original' }, round: 0 }],
    currentRound: 1,
    firstTextBlockStart: true,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // @ts-expect-error accessing protected method for testing
  await anthropic.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).toHaveBeenCalledWith(context)

  // Test unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // @ts-expect-error accessing protected method for testing
  await anthropic.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).not.toHaveBeenCalled()
})

test('Anthropic hook modifies tool results before second API call', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())

  // Register hook that only truncates plugin1 result (not plugin2)
  anthropic.addHook('beforeToolCallsResponse', (context) => {
    for (const entry of context.toolHistory) {
      if (entry.name === 'plugin1') {
        entry.result = '[truncated]'
      }
    }
  })

  const { stream, context } = await anthropic.stream(anthropic.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream to trigger tool execution and second API call
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of anthropic.processNativeChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify second API call has truncated plugin1 but original plugin2
  expect(_Anthropic.default.prototype.messages.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'tool_result', tool_use_id: 1, content: '"[truncated]"' }),
          expect.objectContaining({ type: 'tool_result', tool_use_id: 2, content: '"result2"' }),
        ])
      })
    ])
  }))
})

test('Anthropic thinking block added to thread before tool uses', async () => {
  const anthropic = new Anthropic(config)
  anthropic.addPlugin(new Plugin1())

  const context: AnthropicStreamingContext = {
    model: anthropic.buildModel('model'),
    system: 'instruction',
    thread: [{ role: 'user', content: [{ type: 'text', text: 'prompt' }] }],
    toolCalls: [{ id: 'tool-1', function: 'plugin1', args: '[]', message: '' }],
    toolHistory: [],
    currentRound: 0,
    opts: {},
    firstTextBlockStart: true,
    thinkingBlock: 'This is my reasoning about the tool call',
    thinkingSignature: 'sig123',
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    requestUsage: { prompt_tokens: 0, completion_tokens: 0 }
  }

  // Simulate tool_use stop
  const toolCallChunk = { type: 'message_delta', delta: { stop_reason: 'tool_use' } }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const chunk of anthropic.processNativeChunk(toolCallChunk as any, context)) {
    // consume
  }

  // Verify thinking block was added BEFORE tool uses
  expect(context.thread[1]).toMatchObject({
    role: 'assistant',
    content: [{
      type: 'thinking',
      thinking: 'This is my reasoning about the tool call',
      signature: 'sig123'
    }]
  })

  // Verify tool uses come after thinking block
  expect(context.thread[2]).toMatchObject({
    role: 'assistant',
    content: expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use', id: 'tool-1', name: 'plugin1' })
    ])
  })
})

// Note: Computer tool special result format (spreading instead of JSON stringify)
// is handled in the provider but complex to test due to global mocks.
// This behavior must be preserved during refactoring (see lines 681-693 in anthropic.ts)
