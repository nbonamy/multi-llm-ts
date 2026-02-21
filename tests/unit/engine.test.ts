
import { LlmChunk } from '../../src/types/llm'
import { ToolExecutionDelegate } from '../../src/types/plugin'
import { vi, expect, test, beforeEach } from 'vitest'
import { Plugin1, Plugin2 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI from '../../src/providers/openai'
import Ollama from '../../src/providers/ollama'
import MistralAI from '../../src/providers/mistralai'
import Anthropic from '../../src/providers/anthropic'
import Google from '../../src/providers/google'
import XAI from '../../src/providers/xai'
import Groq from '../../src/providers/groq'
import Cerebras from '../../src/providers/cerebras'
import * as _openai from 'openai'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

const config = { apiKey: '123' }

vi.mock('openai', async() => {
  let streamIteration = 0
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'gpt-model2', name: 'model2' },
        { id: 'gpt-model1', name: 'model1' },
        { id: 'dall-e-model2', name: 'model2' },
        { id: 'dall-e-model1', name: 'model1' },
      ] }
    })
  }
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              // first we yield tool call chunks
              if (opts.model != 'model-no-tool' && opts.model != 'model-vision' && streamIteration == 0) {
                yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
                streamIteration = 1
              } else {
                // now the text response
                const content = 'response'
                for (let i = 0; i < content.length; i++) {
                  yield { choices: [{ delta: { content: content[i] }, finish_reason: 'none' }] }
                }
                yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
              }
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
  return { default: OpenAI }
})

beforeEach(() => {
  vi.clearAllMocks()
})

test('Default Configuration', () => {
  expect(OpenAI.isConfigured({})).toBe(false)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured({})).toBe(false)
  expect(Google.isConfigured({})).toBe(false)
  expect(MistralAI.isConfigured({})).toBe(false)  
  expect(XAI.isConfigured({})).toBe(false)
  expect(Groq.isConfigured({})).toBe(false)
  expect(Cerebras.isConfigured({})).toBe(false)
})

test('Valid Configuration', () => {
  expect(OpenAI.isConfigured(config)).toBe(true)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured(config)).toBe(true)
  expect(Google.isConfigured(config)).toBe(true)
  expect(MistralAI.isConfigured(config)).toBe(true)
  expect(XAI.isConfigured(config)).toBe(true)
  expect(Groq.isConfigured(config)).toBe(true)
  expect(Cerebras.isConfigured(config)).toBe(true)
})

test('Build payload no attachment', async () => {
  const openai = new OpenAI(config)
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), [])).toStrictEqual([]) 
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), 'content')).toStrictEqual([{ role: 'user', content: [{ type: 'text', text: 'content' }] }])
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2'),
    new Message('assistant', 'response2'),
  ])).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [{ type: 'text', text: 'prompt1' }] },
    { role: 'assistant', content: 'response1' },
    { role: 'user', content: [{ type: 'text', text: 'prompt2' }] },
    { role: 'assistant', content: 'response2' }
  ])
})

test('Build payload with text attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { type: 'text', text: 'attachment' },
    ]}
  ])
})

test('Build payload with image attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [{ type: 'text', text: 'prompt1' }] }
  ])
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Build payload with multiple attachments multi-part model', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
      { 'type': 'text', 'text': 'attachment' },
    ]},
  ])

  messages[1].detach(messages[1].attachments[0]) // remove image attachment
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'text', 'text': 'attachment' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Build payload with multiple attachments not multi-part model', async () => {
  const openai = new OpenAI({ baseURL: 'https://api.unknown.com' })
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1\n\nattachment' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])

  messages[1].detach(messages[1].attachments[0]) // remove image attachment
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1\n\nattachment' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Complete content', async () => {
  const openai = new OpenAI({ ...config, ...{ model: { chat: 'gpt-model1' }}})
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  const response = await openai.complete(openai.buildModel('model'), messages)
  expect(response).toStrictEqual({ type: 'text', 'content': 'response', toolCalls: [] })
})

test('Generate content', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  const stream = openai.generate(openai.buildModel('model'), messages)
  expect(stream).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    if (chunk.type == 'content') response += chunk.text
    else if (chunk.type == 'tool') toolCalls.push(chunk)
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
})

test('Generates tool calls information', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
    new Message('assistant', 'response1', undefined, [ { id: 'tool1', function: 'plugin2', args: { param: 'value' }, result : { result: 'ok' } } ]),
  ]
  const stream = openai.generate(openai.buildModel('model'), messages)
  expect(stream).toBeDefined()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-empty
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model', stream: true, stream_options: { include_usage: false },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [{ type: 'text', text: 'prompt1' }] },
      { role: 'assistant', content: 'response1', tool_calls: [
        { id: 'tool1', type: 'function', function: { name: 'plugin2', arguments: JSON.stringify({ param: 'value' }) } }
      ] },
      { role: 'tool', tool_call_id: 'tool1', name: 'plugin2', content: '{"result":"ok"}' },
    ]
  }, {})
})

test('Switch to vision when model provided', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate(openai.buildModel('model-no-tool'), messages, {
    visionFallbackModel: openai.buildModel('model-vision'),
  })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-vision', stream: true, stream_options: { include_usage: false },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [
        { type: 'text', text: 'prompt1' },
        { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
      ]}
    ]
  }, {})
})

test('Cannot switch to vision if not models provided', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate(openai.buildModel('model-no-tool'), messages, { visionFallbackModel: undefined })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-no-tool', stream: true, stream_options: { include_usage: false },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [{ type: 'text', text: 'prompt1' }] }
    ]
  }, {})
})

test('Does not add the same plugin twice', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin2())
  expect(openai.plugins.length).toBe(2)
})

test('Tool execution validation - allow', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({ decision: 'allow' })

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'plugin2', { param: 'value' }, undefined, validator)) {
    chunks.push(update)
  }

  expect(validator).toHaveBeenCalledWith(
    { model: 'model' },
    'plugin2',
    { param: 'value' }
  )
  expect(Plugin2.prototype.execute).toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0].type).toBe('result')
  expect(chunks[0].result).toBe('result2') // Plugin2 mock returns 'result2'
  expect(chunks[0].validation).toMatchObject({ decision: 'allow' })
})

test('Tool execution validation - deny', async () => {
  vi.clearAllMocks()
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'plugin2', { param: 'value' }, undefined, validator)) {
    chunks.push(update)
  }

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({
    type: 'result',
    result: { error: expect.stringContaining('denied by validation function') },
    validation: {
      decision: 'deny',
      extra: { reason: 'Not allowed' }
    }
  })
})

test('Tool execution validation - abort', async () => {
  vi.clearAllMocks()
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Forbidden content' }
  })

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'plugin2', { param: 'value' }, undefined, validator)) {
    chunks.push(update)
  }

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({
    type: 'result',
    result: { error: expect.stringContaining('denied by validation function') },
    validation: {
      decision: 'abort',
      extra: { reason: 'Forbidden content' }
    }
  })
})

test('Tool execution validation - no validator', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'plugin2', { param: 'value' }, undefined)) {
    chunks.push(update)
  }

  expect(Plugin2.prototype.execute).toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0].type).toBe('result')
  expect(chunks[0].result).toBe('result2') // Plugin2 mock returns 'result2'
  expect(chunks[0].validation).toBeUndefined()
})

// Tool execution delegate tests

test('Tool execution delegate - executes delegate tool', async () => {
  const openai = new OpenAI(config)

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{
      name: 'external_tool',
      description: 'An external tool',
      parameters: [{ name: 'input', type: 'string', description: 'Input value', required: true }],
    }],
    execute: vi.fn().mockResolvedValue({ output: 'delegate result' }),
  }

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'external_tool', { input: 'hello' }, delegate)) {
    chunks.push(update)
  }

  expect(delegate.execute).toHaveBeenCalledWith(
    { model: 'model' },
    'external_tool',
    { input: 'hello' }
  )
  expect(chunks).toHaveLength(1)
  expect(chunks[0].type).toBe('result')
  expect(chunks[0].result).toStrictEqual({ output: 'delegate result' })
})

test('Tool execution delegate - plugin takes priority over delegate', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{
      name: 'plugin2',
      description: 'Shadowed by plugin',
      parameters: [],
    }],
    execute: vi.fn().mockResolvedValue('delegate result'),
  }

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'plugin2', { param: 'value' }, delegate)) {
    chunks.push(update)
  }

  expect(delegate.execute).not.toHaveBeenCalled()
  expect(Plugin2.prototype.execute).toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0].result).toBe('result2')
})

test('Tool execution delegate - validation applies to delegate tools', async () => {
  const openai = new OpenAI(config)

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{
      name: 'external_tool',
      description: 'An external tool',
      parameters: [],
    }],
    execute: vi.fn().mockResolvedValue('should not reach'),
  }

  const validator = vi.fn().mockResolvedValue({ decision: 'deny', extra: { reason: 'blocked' } })

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'external_tool', {}, delegate, validator)) {
    chunks.push(update)
  }

  expect(validator).toHaveBeenCalled()
  expect(delegate.execute).not.toHaveBeenCalled()
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({
    type: 'result',
    result: { error: expect.stringContaining('denied by validation function') },
    validation: { decision: 'deny', extra: { reason: 'blocked' } },
  })
})

test('Tool execution delegate - unknown tool without delegate errors', async () => {
  const openai = new OpenAI(config)

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'nonexistent', {})) {
    chunks.push(update)
  }

  expect(chunks).toHaveLength(1)
  expect(chunks[0].result).toStrictEqual({ error: 'Tool nonexistent does not exist. Check the tool list and try again.' })
})

test('Tool execution delegate - getAvailableTools includes delegate tools after plugins', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{
      name: 'external_tool',
      description: 'External',
      parameters: [],
    }],
    execute: vi.fn(),
  }

  // @ts-expect-error protected
  const tools = await openai.getAvailableTools(delegate)
  const names = tools.map((t: any) => t.name)
  expect(names).toContain('external_tool')
  expect(names).toContain('plugin1')
  // plugin tools come first — they take priority in execution
  expect(names.indexOf('plugin1')).toBeLessThan(names.indexOf('external_tool'))
})

test('Tool execution delegate - getAvailableTools deduplicates by plugin priority', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const delegate: ToolExecutionDelegate = {
    getTools: () => [
      { name: 'plugin2', description: 'Shadow attempt', parameters: [] },
      { name: 'unique_tool', description: 'Only in delegate', parameters: [] },
    ],
    execute: vi.fn(),
  }

  // @ts-expect-error protected
  const tools = await openai.getAvailableTools(delegate)
  const names = tools.map((t: any) => t.name)
  // plugin2 appears once (from plugin, not delegate)
  expect(names.filter((n: string) => n === 'plugin2')).toHaveLength(1)
  // unique delegate tool is still included
  expect(names).toContain('unique_tool')
})

test('Tool execution delegate - async getTools', async () => {
  const openai = new OpenAI(config)

  const delegate: ToolExecutionDelegate = {
    getTools: async () => [{
      name: 'async_tool',
      description: 'Loaded asynchronously',
      parameters: [{ name: 'query', type: 'string', description: 'Query' }],
    }],
    execute: vi.fn().mockResolvedValue({ answer: 42 }),
  }

  // @ts-expect-error protected
  const tools = await openai.getAvailableTools(delegate)
  expect(tools).toHaveLength(1)
  expect(tools[0].name).toBe('async_tool')

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model' }, 'async_tool', { query: 'test' }, delegate)) {
    chunks.push(update)
  }

  expect(chunks[0].result).toStrictEqual({ answer: 42 })
})

test('Tool execution delegate - execute error is thrown', async () => {
  const openai = new OpenAI(config)

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{ name: 'failing_tool', description: 'Fails', parameters: [] }],
    execute: vi.fn().mockRejectedValue(new Error('External service down')),
  }

  await expect(async () => {
    // @ts-expect-error protected
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const update of openai.callTool({ model: 'model' }, 'failing_tool', {}, delegate)) {
      // consume
    }
  }).rejects.toThrow('External service down')
})

test('Tool execution delegate - abort during delegate execution', async () => {
  const openai = new OpenAI(config)
  const controller = new AbortController()

  const delegate: ToolExecutionDelegate = {
    getTools: () => [{ name: 'slow_tool', description: 'Slow', parameters: [] }],
    execute: vi.fn().mockImplementation(async () => {
      controller.abort()
      throw new Error('Operation cancelled')
    }),
  }

  const chunks: any[] = []
  // @ts-expect-error protected
  for await (const update of openai.callTool({ model: 'model', abortSignal: controller.signal }, 'slow_tool', {}, delegate)) {
    chunks.push(update)
  }

  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({
    type: 'result',
    result: { error: 'Operation cancelled' },
    canceled: true,
  })
})
