
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Groq from '../../src/providers/groq'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { loadGroqModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import _Groq from 'groq-sdk'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { z } from 'zod'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('groq-sdk', async() => {
  const Groq = vi.fn()
  Groq.prototype.apiKey = '123'
  Groq.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model1-9b', active: true, created: 1 },
        { id: 'model2-70b-preview', active: true, created: 2 },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', active: true, created: 5 },
        { id: 'model3', active: false, created: 3 },
        { id: 'whisper', active: true, created: 4 },
      ]}
    })
  }
  Groq.prototype.chat = {
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
  return { default : Groq }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Groq Load Models', async () => {
  const models = await loadGroqModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Meta Llama/llama 4 Scout 17b 16e Instruct', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
    { id: 'model2-70b-preview', name: 'Model2 70b Preview', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'model1-9b', name: 'Model1 9b', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(await loadModels('groq', config)).toStrictEqual(models)
})

test('Groq Basic', async () => {
  const groq = new Groq(config)
  expect(groq.getName()).toBe('groq')
})

test('Groq completion', async () => {
  const groq = new Groq(config)
  const response = await groq.complete(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
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

test('Groq stream', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  groq.addPlugin(new Plugin2())
  groq.addPlugin(new Plugin3())
  const { stream, context } = await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, top_p: 4 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(1, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg:LlmChunkContent|null  = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of groq.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: '', tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "arg" ]' } } ] },
      { role: 'tool', content: '"result2"', name: 'plugin2', tool_call_id: 1 }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    top_p: 4,
    stream: true,
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await groq.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('Groq stream tool choice option', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'none' } })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: 'none',
  }))
  await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'required' } })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: 'required',
  }))
  const { stream, context } = await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'tool', name: 'plugin1' } })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: { type: 'function', function: { name: 'plugin1' } },
  }))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const chunk of stream) { for await (const msg of groq.nativeChunkToLlmChunk(chunk, context)) {/* empty */ } }
  expect(_Groq.prototype.chat.completions.create).toHaveBeenLastCalledWith(expect.objectContaining({
    tool_choice: 'auto',
  }))
})

  test('Groq stream tools disabled', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  groq.addPlugin(new Plugin2())
  groq.addPlugin(new Plugin3())
  await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, top_p: 4, tools: false })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    top_p: 4,
    stream: true,
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Groq stream without tools', async () => {
  const groq = new Groq(config)
  const { stream } = await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
})

test('Groq nativeChunkToLlmChunk Text', async () => {
  const groq = new Groq(config)
  const streamChunk: ChatCompletionChunk = {
    id: '123', model: 'model1', created: 1, object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'response' }, finish_reason: null }],
  }
  const context = {
    model: groq.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.choices[0].finish_reason = 'stop'
  streamChunk.choices[0].delta.content = null
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Groq structured output', async () => {
  const groq = new Groq(config)
  await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(_Groq.prototype.chat.completions.create.mock.calls[0][0].response_format).toStrictEqual({
    type: 'json_object',
  })
})

test('Groq streaming validation deny - yields canceled chunk', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Policy violation' }
  })

  const chunks: LlmChunk[] = []
  // @ts-expect-error protected
  const context = {
    model: groq.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: 1, function: 'plugin2', args: '{}', message: [] }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  for await (const chunk of groq.nativeChunkToLlmChunk(toolCallChunk, context)) {
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

test('Groq streaming validation abort - yields tool_abort chunk', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  const chunks: LlmChunk[] = []
  // @ts-expect-error protected
  const context = {
    model: groq.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: 1, function: 'plugin2', args: '{}', message: [] }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason - abort throws, so we need to catch it
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  try {
    for await (const chunk of groq.nativeChunkToLlmChunk(toolCallChunk, context)) {
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

test('Groq chat validation deny - throws error', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  // Mock to return tool calls
  _Groq.prototype.chat.completions.create = vi.fn().mockResolvedValue({
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
  })

  await expect(
    groq.complete(groq.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
  ).rejects.toThrow('Tool execution was canceled')

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Groq chat validation abort - throws LlmChunkToolAbort', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  // Mock to return tool calls
  _Groq.prototype.chat.completions.create = vi.fn().mockResolvedValue({
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
  })

  try {
    await groq.complete(groq.buildModel('model'), [
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