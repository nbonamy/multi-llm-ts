
import { vi, expect, test, describe, beforeEach } from 'vitest'
import { LlmChunk, LlmToolCall, NormalizedToolChunk, LlmStreamingContext, LlmStream } from '../../src/types/llm'
import { Plugin1, Plugin2, PluginUpdate } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import * as _openai from 'openai'

// Mock plugins
Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

const config = { apiKey: '123' }

// Simple mock for OpenAI client
vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => ({ data: [] }))
  }
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }
        },
        controller: { abort: vi.fn() }
      }))
    }
  }
  return { default: OpenAI }
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processToolCallChunk', () => {

  test('start type creates new tool call and yields preparing notification', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }
    const normalized: NormalizedToolChunk = {
      type: 'start',
      id: 'tool-1',
      name: 'plugin2',
      args: '',
    }

    // @ts-expect-error protected method
    const chunks = Array.from(openai.processToolCallChunk(normalized, context))

    // Should create tool call
    expect(context.toolCalls).toHaveLength(1)
    expect(context.toolCalls[0]).toMatchObject({
      id: 'tool-1',
      function: 'plugin2',
      args: '',
    })

    // Should yield preparing notification
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      type: 'tool',
      id: 'tool-1',
      name: 'plugin2',
      state: 'preparing',
      status: 'prep2',
      done: false
    })
  })

  test('start type with complete args (Google-style)', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }
    const normalized: NormalizedToolChunk = {
      type: 'start',
      id: 'tool-1',
      name: 'plugin2',
      args: '{"param":"value"}',
    }

    // @ts-expect-error protected method
    const chunks = Array.from(openai.processToolCallChunk(normalized, context))

    // Should create tool call with complete args
    expect(context.toolCalls).toHaveLength(1)
    expect(context.toolCalls[0].args).toBe('{"param":"value"}')
    expect(chunks).toHaveLength(1)
  })

  test('start type with metadata propagates thoughtSignature', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }
    const normalized: NormalizedToolChunk = {
      type: 'start',
      id: 'tool-1',
      name: 'plugin2',
      args: '',
      metadata: { thoughtSignature: 'sig123' }
    }

    // @ts-expect-error protected method
    Array.from(openai.processToolCallChunk(normalized, context))

    expect(context.toolCalls[0].thoughtSignature).toBe('sig123')
  })

  test('start type with metadata propagates reasoningDetails', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }
    const normalized: NormalizedToolChunk = {
      type: 'start',
      id: 'tool-1',
      name: 'plugin2',
      args: '',
      metadata: { reasoningDetails: { steps: ['step1', 'step2'] } }
    }

    // @ts-expect-error protected method
    Array.from(openai.processToolCallChunk(normalized, context))

    expect(context.toolCalls[0].reasoningDetails).toEqual({ steps: ['step1', 'step2'] })
  })

  test('delta type appends arguments to existing tool call', () => {
    const openai = new OpenAI(config)

    const context = {
      toolCalls: [{
        id: 'tool-1',
        function: 'plugin2',
        args: '{"param":',
        message: ''
      }] as LlmToolCall[]
    }
    const normalized: NormalizedToolChunk = {
      type: 'delta',
      argumentsDelta: '"value"}'
    }

    // @ts-expect-error protected method
    const chunks = Array.from(openai.processToolCallChunk(normalized, context))

    // Should append to args
    expect(context.toolCalls[0].args).toBe('{"param":"value"}')
    // Should not yield anything for delta
    expect(chunks).toHaveLength(0)
  })

  test('delta type does nothing when no tool call exists', () => {
    const openai = new OpenAI(config)

    const context = { toolCalls: [] as LlmToolCall[] }
    const normalized: NormalizedToolChunk = {
      type: 'delta',
      argumentsDelta: '"value"}'
    }

    // @ts-expect-error protected method
    const chunks = Array.from(openai.processToolCallChunk(normalized, context))

    // Should not crash, should not yield anything
    expect(chunks).toHaveLength(0)
    expect(context.toolCalls).toHaveLength(0)
  })

  test('multiple start chunks create multiple tool calls', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin1())
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }

    // First tool call
    // @ts-expect-error protected method
    const chunks1 = Array.from(openai.processToolCallChunk({
      type: 'start',
      id: 'tool-1',
      name: 'plugin1',
      args: ''
    }, context))

    // Second tool call
    // @ts-expect-error protected method
    const chunks2 = Array.from(openai.processToolCallChunk({
      type: 'start',
      id: 'tool-2',
      name: 'plugin2',
      args: ''
    }, context))

    expect(context.toolCalls).toHaveLength(2)
    expect(context.toolCalls[0].id).toBe('tool-1')
    expect(context.toolCalls[1].id).toBe('tool-2')
    expect(chunks1).toHaveLength(1)
    expect(chunks2).toHaveLength(1)
  })

  test('interleaved start and delta chunks accumulate correctly', () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const context = { toolCalls: [] as LlmToolCall[] }

    // Start
    // @ts-expect-error protected method
    openai.processToolCallChunk({
      type: 'start', id: 'tool-1', name: 'plugin2', args: '{"a":'
    }, context).next()

    // Delta 1
    // @ts-expect-error protected method
    openai.processToolCallChunk({
      type: 'delta', argumentsDelta: '"val'
    }, context).next()

    // Delta 2
    // @ts-expect-error protected method
    openai.processToolCallChunk({
      type: 'delta', argumentsDelta: 'ue"}'
    }, context).next()

    expect(context.toolCalls[0].args).toBe('{"a":"value"}')
  })

})

describe('executeToolCallsSequentially', () => {

  function createMockContext(): any {
    return {
      model: { id: 'test-model' },
      opts: { usage: false },
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      toolCalls: [],
      toolHistory: [],
      currentRound: 1,
      thread: []
    }
  }

  test('executes single tool call successfully', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '["arg1"]',
      message: ''
    }]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (tc, _args) => ({ role: 'assistant', tool_calls: [tc] }),
      formatToolResultForThread: (result, tc, _args) => ({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) {
      chunks.push(chunk)
    }

    // Should have running and completed states
    expect(chunks.some(c => c.type === 'tool' && (c as any).state === 'running')).toBe(true)
    expect(chunks.some(c => c.type === 'tool' && (c as any).state === 'completed')).toBe(true)

    // Should have called the plugin
    expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'test-model' }, ['arg1'])

    // Should have added to thread
    expect(context.thread).toHaveLength(2)
    expect(context.thread[0]).toMatchObject({ role: 'assistant' })
    expect(context.thread[1]).toMatchObject({ role: 'tool', tool_call_id: 'tool-1' })

    // Should have added to tool history
    expect(context.toolHistory).toHaveLength(1)
    expect(context.toolHistory[0]).toMatchObject({
      id: 'tool-1',
      name: 'plugin2',
      round: 1
    })

    // Should end with stream chunk for recursion
    expect(chunks[chunks.length - 1].type).toBe('stream')
  })

  test('executes multiple tool calls sequentially', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin1())
    openai.addPlugin(new Plugin2())

    const toolCalls: LlmToolCall[] = [
      { id: 'tool-1', function: 'plugin1', args: '[]', message: '' },
      { id: 'tool-2', function: 'plugin2', args: '["arg"]', message: '' }
    ]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (tc, _args) => ({ role: 'assistant', tool_calls: [tc] }),
      formatToolResultForThread: (result, tc, _args) => ({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) {
      chunks.push(chunk)
    }

    // Should have called both plugins
    expect(Plugin1.prototype.execute).toHaveBeenCalled()
    expect(Plugin2.prototype.execute).toHaveBeenCalled()

    // Should have two tool history entries
    expect(context.toolHistory).toHaveLength(2)
    expect(context.toolHistory[0].id).toBe('tool-1')
    expect(context.toolHistory[1].id).toBe('tool-2')

    // Should have 4 thread entries (2 tool calls + 2 results)
    expect(context.thread).toHaveLength(4)
  })

  test('throws error for invalid JSON args', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: 'invalid json{',
      message: ''
    }]

    const context = createMockContext()

    // @ts-expect-error protected method
    const generator = openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({} as LlmStream)
    })

    await expect(async () => {
      for await (const _chunk of generator) { /* consume */ }
    }).rejects.toThrow('invalid JSON args')
  })

  test('handles abort signal during execution', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const abortController = new AbortController()
    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = {
      ...createMockContext(),
      opts: { abortSignal: abortController.signal }
    }

    // Abort immediately
    abortController.abort()

    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({} as LlmStream)
    })) {
      chunks.push(chunk)
    }

    // Should have yielded running then canceled
    const toolChunks = chunks.filter(c => c.type === 'tool')
    expect(toolChunks.length).toBeGreaterThan(0)
    expect(toolChunks[toolChunks.length - 1]).toMatchObject({
      type: 'tool',
      state: 'canceled'
    })

    // Should NOT have continued to stream
    expect(chunks[chunks.length - 1].type).not.toBe('stream')
  })

  test('propagates reasoningDetails in running notification', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: '',
      reasoningDetails: { reasoning: 'test' }
    }]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) {
      chunks.push(chunk)
    }

    const runningChunk = chunks.find(c => c.type === 'tool' && (c as any).state === 'running')
    expect(runningChunk).toBeDefined()
    expect((runningChunk as any).reasoningDetails).toEqual({ reasoning: 'test' })
  })

  test('calls beforeToolCallsResponse hook', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const hookFn = vi.fn()
    openai.addHook('beforeToolCallsResponse', hookFn)

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()

    // @ts-expect-error protected method
    for await (const _chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) { /* consume */ }

    expect(hookFn).toHaveBeenCalledWith(expect.objectContaining({
      model: { id: 'test-model' }
    }))
  })

  test('uses formatToolCallForThread callback correctly', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const formatToolCallFn = vi.fn((tc: LlmToolCall, _args: any) => ({
      role: 'assistant',
      custom_tool_format: tc.id
    }))

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()

    // @ts-expect-error protected method
    for await (const _chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: formatToolCallFn,
      formatToolResultForThread: (_result, tc, _args) => ({ role: 'tool', tool_call_id: tc.id }),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) { /* consume */ }

    expect(formatToolCallFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool-1' }), [])
    expect(context.thread[0]).toMatchObject({ custom_tool_format: 'tool-1' })
  })

  test('uses formatToolResultForThread callback correctly', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const formatResultFn = vi.fn((result: any, tc: LlmToolCall, _args: any) => ({
      role: 'tool',
      custom_result: result,
      custom_id: tc.id
    }))

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()

    // @ts-expect-error protected method
    for await (const _chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({ role: 'assistant' }),
      formatToolResultForThread: formatResultFn,
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) { /* consume */ }

    expect(formatResultFn).toHaveBeenCalledWith('result2', expect.objectContaining({ id: 'tool-1' }), [])
    expect(context.thread[1]).toMatchObject({ custom_id: 'tool-1' })
  })

  test('creates new stream via callback for recursion', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const createStreamFn = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'final' }, finish_reason: 'stop' }] }
      }
    }) as unknown as LlmStream)

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: createStreamFn
    })) {
      chunks.push(chunk)
    }

    expect(createStreamFn).toHaveBeenCalledWith(context)
    expect(chunks[chunks.length - 1].type).toBe('stream')
  })

  test('handles plugin with status updates', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new PluginUpdate())

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'pluginUpdate',
      args: '{}',
      message: ''
    }]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) {
      chunks.push(chunk)
    }

    // Should have status updates from plugin
    const runningChunks = chunks.filter(c => c.type === 'tool' && (c as any).state === 'running')
    expect(runningChunks.length).toBeGreaterThanOrEqual(2)
    expect(runningChunks.some(c => (c as any).status === 'status1')).toBe(true)
    expect(runningChunks.some(c => (c as any).status === 'status2')).toBe(true)
  })

  test('handles tool that does not exist', async () => {
    const openai = new OpenAI(config)
    // NOT adding any plugins

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'nonexistent',
      args: '{}',
      message: ''
    }]

    const context = createMockContext()
    const chunks: LlmChunk[] = []

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) {
      chunks.push(chunk)
    }

    // Should complete with error in result
    const completedChunk = chunks.find(c => c.type === 'tool' && (c as any).state === 'completed')
    expect(completedChunk).toBeDefined()
    expect((completedChunk as any).call.result).toMatchObject({
      error: expect.stringContaining('does not exist')
    })
  })

  test('increments currentRound is handled by caller', async () => {
    // Note: currentRound incrementing should be done by the caller
    // This test verifies the base method doesn't modify it
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const toolCalls: LlmToolCall[] = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()
    context.currentRound = 5

    // @ts-expect-error protected method
    for await (const _chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: (_tc, _args) => ({}),
      formatToolResultForThread: (_result, _tc, _args) => ({}),
      createNewStream: async () => ({
        async *[Symbol.asyncIterator]() { yield { choices: [{ finish_reason: 'stop' }] } }
      }) as unknown as LlmStream
    })) { /* consume */ }

    // Round should stay the same (caller increments)
    expect(context.currentRound).toBe(5)
    // But tool history should have recorded the round
    expect(context.toolHistory[0].round).toBe(5)
  })

})
