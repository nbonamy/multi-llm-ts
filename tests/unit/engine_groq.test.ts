
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Groq, { GroqStreamingContext } from '../../src/providers/groq'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { loadGroqModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import _Groq from 'groq-sdk'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { z } from 'zod'

Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
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

              // first we yield tool call chunks for multiple tools (not for reasoning models)
              if (!opts.model.startsWith('o1-') && !opts.model.includes('reasoning')) {
                // First tool call: plugin1 with empty args (index 0)
                yield { choices: [{ delta: { tool_calls: [ { index: 0, id: '1', function: { name: 'plugin1', arguments: '[]' }} ] }, finish_reason: 'none' } ] }

                // Second tool call: plugin2 with args split across chunks (index 1)
                yield { choices: [{ delta: { tool_calls: [ { index: 1, id: '2', function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { index: 1, function: { arguments: 'g" ]' } }] }, finish_reason: 'none' } ] }

                // Finish reason to trigger processing of both accumulated tools
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
              }

              // yield reasoning chunks if it's a reasoning model
              const reasoning = 'reasoning'
              for (let i = 0; i < reasoning.length; i++) {
                yield { choices: [{ delta: { reasoning: reasoning[i] }, finish_reason: 'none' }] }
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

test('Groq buildPayload with tool calls', async () => {
  const groq = new Groq(config)
  const message = new Message('assistant', 'text', undefined, [
    { id: 'tool1', function: 'plugin2', args: { param: 'value' }, result: { result: 'ok' } }
  ])
  expect(groq.buildPayload(groq.buildModel('gpt-3.5'), [ message ])).toStrictEqual([
    { role: 'assistant', content: 'text', tool_calls: [
      { id: 'tool1', type: 'function', function: { name: 'plugin2', arguments: '{"param":"value"}' } }
    ] },
    { role: 'tool', tool_call_id: 'tool1', name: 'plugin2', content: '{"result":"ok"}' }
  ])
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
  let reasoning = ''
  let lastMsg:LlmChunkContent|null  = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of groq.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'reasoning') reasoning += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, {
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
    top_p: 4,
    stream: true,
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(reasoning).toBe('reasoning')
  expect(Plugin1.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, [])
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])

  // Verify tool call sequence: preparing for both tools, then running, then completed
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'preparing', status: 'prep1', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'running', status: 'run1 with []', call: { params: [], result: undefined }, done: false })
  expect(toolCalls[3]).toStrictEqual({ type: 'tool', id: '1', name: 'plugin1', state: 'completed', call: { params: [], result: 'result1' }, status: undefined, done: true })
  expect(toolCalls[4]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[5]).toStrictEqual({ type: 'tool', id: '2', name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
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
  const context = {
    model: groq.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: 1, function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  // @ts-expect-error mock
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
  const context = {
    model: groq.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: 1, function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason - abort throws, so we need to catch it
  const toolCallChunk = { choices: [{ finish_reason: 'tool_calls' }] }
  try {
    // @ts-expect-error mock
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

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_Groq.prototype.chat.completions.create).mockImplementationOnce(() => Promise.resolve({
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

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_Groq.prototype.chat.completions.create).mockImplementationOnce(() => Promise.resolve({
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

test('Groq syncToolHistoryToThread updates thread from toolHistory', () => {
  const groq = new Groq(config)

  // Groq uses same format as OpenAI: { role: 'tool', tool_call_id, content }
  const context: GroqStreamingContext = {
    model: groq.buildModel('model'),
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
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Call syncToolHistoryToThread
  groq.syncToolHistoryToThread(context)

  // Verify thread was updated
  const toolMessage1 = context.thread.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_1') as any
  const toolMessage2 = context.thread.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_2') as any

  expect(toolMessage1.content).toBe(JSON.stringify({ modified: 'truncated' }))
  expect(toolMessage2.content).toBe(JSON.stringify({ modified: 'truncated2' }))
})

test('Groq addHook and hook execution', async () => {
  const groq = new Groq(config)

  const hookCallback = vi.fn()
  const unsubscribe = groq.addHook('beforeToolCallsResponse', hookCallback)

  const context: GroqStreamingContext = {
    model: groq.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: { data: 'original' }, round: 0 }],
    currentRound: 1,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // @ts-expect-error accessing protected method for testing
  await groq.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).toHaveBeenCalledWith(context)

  // Test unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // @ts-expect-error accessing protected method for testing
  await groq.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).not.toHaveBeenCalled()
})

test('Groq hook modifies tool results before second API call', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  groq.addPlugin(new Plugin2())

  // Register hook that only truncates plugin1 result (not plugin2)
  groq.addHook('beforeToolCallsResponse', (context) => {
    for (const entry of context.toolHistory) {
      if (entry.name === 'plugin1') {
        entry.result = '[truncated]'
      }
    }
  })

  const { stream, context } = await groq.stream(groq.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream to trigger tool execution and second API call
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of groq.nativeChunkToLlmChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify second API call has truncated plugin1 but original plugin2
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: '1', content: '"[truncated]"' }),
      expect.objectContaining({ role: 'tool', tool_call_id: '2', content: '"result2"' }),
    ])
  }))
})