
import { vi, expect, test, describe, beforeEach } from 'vitest'
import { LlmStream } from '../../src/types/llm'
import { Plugin1, Plugin2 } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import * as _openai from 'openai'

// Mock plugins
Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

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

describe('applyCooldown', () => {

  test('delays when elapsed time is less than cooldown', async () => {
    const openai = new OpenAI({ apiKey: '123', requestCooldown: 100 })

    const startTime = Date.now()

    // @ts-expect-error protected method
    await openai.applyCooldown(startTime)

    const elapsed = Date.now() - startTime
    expect(elapsed).toBeGreaterThanOrEqual(95) // Allow small timing variance
  })

  test('does not delay when elapsed time exceeds cooldown', async () => {
    const openai = new OpenAI({ apiKey: '123', requestCooldown: 50 })

    // Simulate startTime 100ms ago
    const startTime = Date.now() - 100
    const beforeApply = Date.now()

    // @ts-expect-error protected method
    await openai.applyCooldown(startTime)

    const elapsed = Date.now() - beforeApply
    expect(elapsed).toBeLessThan(20) // Should be nearly instant
  })

  test('does not delay when no cooldown configured', async () => {
    const openai = new OpenAI({ apiKey: '123' }) // No requestCooldown

    const startTime = Date.now()
    const beforeApply = Date.now()

    // @ts-expect-error protected method
    await openai.applyCooldown(startTime)

    const elapsed = Date.now() - beforeApply
    expect(elapsed).toBeLessThan(20) // Should be nearly instant
  })

  test('waits only the remaining time', async () => {
    const openai = new OpenAI({ apiKey: '123', requestCooldown: 100 })

    // Simulate startTime 50ms ago - should only wait ~50ms more
    const startTime = Date.now() - 50
    const beforeApply = Date.now()

    // @ts-expect-error protected method
    await openai.applyCooldown(startTime)

    const elapsed = Date.now() - beforeApply
    expect(elapsed).toBeGreaterThanOrEqual(45) // Should wait remaining ~50ms
    expect(elapsed).toBeLessThan(80) // But not the full 100ms
  })

})

describe('cooldown in streaming tool execution', () => {

  function createMockContext(): any {
    return {
      model: { id: 'test-model' },
      opts: { usage: false },
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      toolCalls: [],
      toolHistory: [],
      currentRound: 1,
      startTime: 0,
      thread: []
    }
  }

  test('applies cooldown before creating new stream', async () => {
    const openai = new OpenAI({ apiKey: '123', requestCooldown: 100 })
    openai.addPlugin(new Plugin2())

    const toolCalls = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()
    context.startTime = Date.now()

    const createStreamFn = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'final' }, finish_reason: 'stop' }] }
      }
    }) as unknown as LlmStream)

    const beforeExecute = Date.now()

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: () => ({}),
      formatToolResultForThread: () => ({}),
      createNewStream: createStreamFn
    })) { void chunk }

    const elapsed = Date.now() - beforeExecute

    // Should have waited for cooldown before creating new stream
    expect(elapsed).toBeGreaterThanOrEqual(95)
    expect(createStreamFn).toHaveBeenCalled()
  })

  test('no delay when cooldown not configured', async () => {
    const openai = new OpenAI({ apiKey: '123' }) // No cooldown
    openai.addPlugin(new Plugin2())

    const toolCalls = [{
      id: 'tool-1',
      function: 'plugin2',
      args: '[]',
      message: ''
    }]

    const context = createMockContext()
    context.startTime = Date.now()

    const createStreamFn = vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'final' }, finish_reason: 'stop' }] }
      }
    }) as unknown as LlmStream)

    const beforeExecute = Date.now()

    // @ts-expect-error protected method
    for await (const chunk of openai.executeToolCallsSequentially(toolCalls, context, {
      formatToolCallForThread: () => ({}),
      formatToolResultForThread: () => ({}),
      createNewStream: createStreamFn
    })) { void chunk }

    const elapsed = Date.now() - beforeExecute

    // Should complete quickly without cooldown
    expect(elapsed).toBeLessThan(50)
  })

})
