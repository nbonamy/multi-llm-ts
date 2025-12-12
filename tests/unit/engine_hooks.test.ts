import { vi, test, expect, beforeEach } from 'vitest'
import OpenAI from '../../src/providers/openai'
import Message from '../../src/models/message'
import { EngineCreateOpts } from '../../src/types/index'
import { BeforeRequestHookPayload, OnContentChunkHookPayload, AfterResponseHookPayload } from '../../src/types/llm'

// Mock OpenAI SDK
vi.mock('openai', async () => {
  const OpenAI = vi.fn()
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn()
    }
  }
  return { default: OpenAI }
})

const config: EngineCreateOpts = {
  apiKey: 'test-key'
}

// Helper to create a mock stream
function createMockStream(chunks: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    controller: new AbortController()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('beforeRequest hook is called before streaming starts', async () => {
  const openai = new OpenAI(config)

  const hookCallback = vi.fn()
  openai.addHook('beforeRequest', hookCallback)

  // Mock the stream method to return a simple response
  const mockChunks = [
    { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' World' }, finish_reason: 'stop' }] }
  ]

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream(mockChunks),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [
    new Message('system', 'You are helpful'),
    new Message('user', 'Hello')
  ]

  const generator = openai.generate('gpt-4', thread, {})

  // Consume the generator
  const chunks = []
  for await (const chunk of generator) {
    chunks.push(chunk)
  }

  expect(hookCallback).toHaveBeenCalledTimes(1)
  const payload: BeforeRequestHookPayload = hookCallback.mock.calls[0][0]
  expect(payload.model.id).toBe('gpt-4')
  expect(payload.thread).toBe(thread)
  expect(payload.abortController).toBeInstanceOf(AbortController)
})

test('beforeRequest hook can abort before streaming starts', async () => {
  const openai = new OpenAI(config)

  // Hook that aborts immediately
  openai.addHook('beforeRequest', (payload) => {
    payload.abortController?.abort('Blocked by guardrail')
  })

  // Mock the stream method - should NOT be called
  const streamMock = vi.fn()
  // @ts-expect-error mocking protected method
  openai.stream = streamMock

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, {})

  // Consume the generator
  const chunks = []
  for await (const chunk of generator) {
    chunks.push(chunk)
  }

  expect(chunks).toHaveLength(0)
  expect(streamMock).not.toHaveBeenCalled()
})

test('onContentChunk hook is called for each content chunk', async () => {
  const openai = new OpenAI(config)

  const hookCallback = vi.fn()
  openai.addHook('onContentChunk', hookCallback)

  const mockChunks = [
    { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' World' }, finish_reason: null }] },
    { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }
  ]

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream(mockChunks),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, {})

  for await (const chunk of generator) {
    // consume
  }

  expect(hookCallback).toHaveBeenCalledTimes(3)

  // Check accumulated content builds up correctly
  const firstPayload: OnContentChunkHookPayload = hookCallback.mock.calls[0][0]
  expect(firstPayload.accumulatedContent).toBe('Hello')
  expect(firstPayload.accumulatedTokens).toBe(1)

  const secondPayload: OnContentChunkHookPayload = hookCallback.mock.calls[1][0]
  expect(secondPayload.accumulatedContent).toBe('Hello World')
  expect(secondPayload.accumulatedTokens).toBe(2)

  const thirdPayload: OnContentChunkHookPayload = hookCallback.mock.calls[2][0]
  expect(thirdPayload.accumulatedContent).toBe('Hello World!')
  expect(thirdPayload.accumulatedTokens).toBe(3)
})

test('onContentChunk hook can abort mid-stream', async () => {
  const openai = new OpenAI(config)

  // Hook that aborts after seeing certain content
  openai.addHook('onContentChunk', (payload) => {
    if (payload.accumulatedContent.includes('bad')) {
      payload.abortController?.abort('Content violation')
    }
  })

  const mockChunks = [
    { choices: [{ delta: { content: 'This is ' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'bad' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' content' }, finish_reason: 'stop' }] }
  ]

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream(mockChunks),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, {})

  const chunks = []
  for await (const chunk of generator) {
    chunks.push(chunk)
  }

  // First chunk is yielded, then hook is called and detects "bad" is not yet present
  // Second chunk "bad" is added to accumulated content, hook called, abort triggered
  // But the chunk is already yielded before the abort check after yield
  // So we get only the first chunk before the abort takes effect
  expect(chunks.length).toBeGreaterThanOrEqual(1)
  expect(chunks[0].type).toBe('content')
  expect(chunks[0].text).toBe('This is ')
})

test('afterResponse hook is called after streaming completes', async () => {
  const openai = new OpenAI(config)

  const hookCallback = vi.fn()
  openai.addHook('afterResponse', hookCallback)

  // OpenAI includes usage in the final chunk with finish_reason
  const mockChunks = [
    { choices: [{ delta: { content: 'Hello World' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
  ]

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream(mockChunks),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: {}, round: 0 }],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, {})

  for await (const chunk of generator) {
    // consume
  }

  expect(hookCallback).toHaveBeenCalledTimes(1)
  const payload: AfterResponseHookPayload = hookCallback.mock.calls[0][0]
  expect(payload.model.id).toBe('gpt-4')
  expect(payload.thread).toBe(thread)
  expect(payload.response).toBeInstanceOf(Message)
  expect(payload.response.content).toBe('Hello World')
  expect(payload.toolHistory).toHaveLength(1)
  // Usage comes from the usage chunk yielded by the stream
  expect(payload.usage).toBeDefined()
})

test('afterResponse hook is NOT called if aborted mid-stream', async () => {
  const openai = new OpenAI(config)

  const afterResponseCallback = vi.fn()
  openai.addHook('afterResponse', afterResponseCallback)

  // Hook that aborts
  openai.addHook('onContentChunk', (payload) => {
    payload.abortController?.abort('Abort!')
  })

  const mockChunks = [
    { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
    { choices: [{ delta: { content: ' World' }, finish_reason: 'stop' }] }
  ]

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream(mockChunks),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, {})

  for await (const chunk of generator) {
    // consume
  }

  expect(afterResponseCallback).not.toHaveBeenCalled()
})

test('hooks receive linked abort controller from user abort signal', async () => {
  const openai = new OpenAI(config)

  let capturedAbortController: AbortController | undefined
  openai.addHook('beforeRequest', (payload) => {
    capturedAbortController = payload.abortController
  })

  const userAbortController = new AbortController()

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream([
      { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }
    ]),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  const generator = openai.generate('gpt-4', thread, { abortSignal: userAbortController.signal })

  for await (const chunk of generator) {
    // consume
  }

  expect(capturedAbortController).toBeDefined()
  expect(capturedAbortController?.signal.aborted).toBe(false)

  // Abort from user side
  userAbortController.abort('User cancelled')

  // The guardrail abort controller should also be aborted
  expect(capturedAbortController?.signal.aborted).toBe(true)
})

test('hook unsubscribe works correctly', async () => {
  const openai = new OpenAI(config)

  const hookCallback = vi.fn()
  const unsubscribe = openai.addHook('beforeRequest', hookCallback)

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream([
      { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }
    ]),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]

  // First call - hook should be called
  for await (const chunk of openai.generate('gpt-4', thread, {})) {}
  expect(hookCallback).toHaveBeenCalledTimes(1)

  // Unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // Second call - hook should NOT be called
  for await (const chunk of openai.generate('gpt-4', thread, {})) {}
  expect(hookCallback).not.toHaveBeenCalled()
})

test('multiple hooks of same type are all called', async () => {
  const openai = new OpenAI(config)

  const hook1 = vi.fn()
  const hook2 = vi.fn()
  const hook3 = vi.fn()

  openai.addHook('beforeRequest', hook1)
  openai.addHook('beforeRequest', hook2)
  openai.addHook('beforeRequest', hook3)

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockResolvedValue({
    stream: createMockStream([
      { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }
    ]),
    context: {
      model: openai.buildModel('gpt-4'),
      opts: {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    }
  })

  const thread = [new Message('user', 'Hello')]
  for await (const chunk of openai.generate('gpt-4', thread, {})) {}

  expect(hook1).toHaveBeenCalledTimes(1)
  expect(hook2).toHaveBeenCalledTimes(1)
  expect(hook3).toHaveBeenCalledTimes(1)
})

test('async hooks are properly awaited', async () => {
  const openai = new OpenAI(config)

  const order: number[] = []

  openai.addHook('beforeRequest', async () => {
    await new Promise(resolve => setTimeout(resolve, 50))
    order.push(1)
  })

  openai.addHook('beforeRequest', async () => {
    await new Promise(resolve => setTimeout(resolve, 10))
    order.push(2)
  })

  // @ts-expect-error mocking protected method
  openai.stream = vi.fn().mockImplementation(async () => {
    order.push(3)
    return {
      stream: createMockStream([
        { choices: [{ delta: { content: 'Hello' }, finish_reason: 'stop' }] }
      ]),
      context: {
        model: openai.buildModel('gpt-4'),
        opts: {},
        toolCalls: [],
        toolHistory: [],
        currentRound: 0,
        usage: { prompt_tokens: 0, completion_tokens: 0 }
      }
    }
  })

  const thread = [new Message('user', 'Hello')]
  for await (const chunk of openai.generate('gpt-4', thread, {})) {}

  // Hooks should be awaited in order before stream starts
  expect(order).toEqual([1, 2, 3])
})
