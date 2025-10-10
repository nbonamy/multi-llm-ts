
import { vi, beforeEach, expect, test, describe } from 'vitest'
import { Plugin2 } from '../mocks/plugins'
import Message from '../../src/models/message'
import OpenAI from '../../src/providers/openai'
import { EngineCreateOpts } from '../../src/types/index'
import { LlmChunk, LlmChunkToolAbort } from '../../src/types/llm'
import * as _openai from 'openai'

// Mock Plugin2 execution
Plugin2.prototype.execute = vi.fn((): Promise<any> => Promise.resolve({ success: true }))

// Track call count for controlling mock behavior
let mockCallCount = 0

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })

  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        mockCallCount++

        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              // First call: yield tool call chunks
              if (mockCallCount === 1) {
                yield { choices: [{ delta: { tool_calls: [ { id: 'tool_1', function: { name: 'plugin2', arguments: '{}' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
              } else {
                // Subsequent calls: yield text response
                yield { choices: [{ delta: { content: 'final response' }, finish_reason: 'none' }] }
                yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
              }
            },
            controller: {
              abort: vi.fn()
            }
          }
        } else {
          // Non-streaming: return tool call or text
          if (mockCallCount === 1 && opts.tools) {
            return {
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
            }
          } else {
            return {
              choices: [{ message: { content: 'final response' }, finish_reason: 'stop' }]
            }
          }
        }
      })
    }
  }

  return { default: OpenAI }
})

let config: EngineCreateOpts = {}

beforeEach(() => {
  vi.clearAllMocks()
  mockCallCount = 0
  config = { apiKey: '123' }
})

describe('Streaming validation integration tests', () => {

  test('Streaming with validation deny - yields canceled chunk', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'deny',
      extra: { reason: 'Policy violation' }
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    const chunks: LlmChunk[] = []
    const stream = openai.generate(openai.buildModel('model'), messages, { toolExecutionValidation: validator })

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // Validator should have been called
    expect(validator).toHaveBeenCalled()
    // Plugin should NOT have executed
    expect(Plugin2.prototype.execute).not.toHaveBeenCalled()

    // Find tool chunks
    const toolChunks = chunks.filter(c => c.type === 'tool')
    expect(toolChunks.length).toBeGreaterThan(0)

    // Last tool chunk should be canceled
    const lastToolChunk = toolChunks[toolChunks.length - 1]
    expect(lastToolChunk).toMatchObject({
      type: 'tool',
      name: 'plugin2',
      state: 'canceled',
      done: true
    })

    // Should still get final response since deny doesn't abort the entire stream
    const contentChunks = chunks.filter(c => c.type === 'content')
    expect(contentChunks.length).toBeGreaterThan(0)
  })

  test('Streaming with validation abort - yields tool_abort chunk', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'abort',
      extra: { reason: 'Security violation' }
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    const chunks: LlmChunk[] = []
    const stream = openai.generate(openai.buildModel('model'), messages, { toolExecutionValidation: validator })

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // Validator should have been called
    expect(validator).toHaveBeenCalled()
    // Plugin should NOT have executed
    expect(Plugin2.prototype.execute).not.toHaveBeenCalled()

    // Should have received a tool_abort chunk
    const abortChunks = chunks.filter(c => c.type === 'tool_abort') as LlmChunkToolAbort[]
    expect(abortChunks.length).toBe(1)
    expect(abortChunks[0]).toMatchObject({
      type: 'tool_abort',
      name: 'plugin2',
      params: {},
      reason: {
        decision: 'abort',
        extra: { reason: 'Security violation' }
      }
    })

    // Should NOT get final response since abort stops the stream
    const contentChunks = chunks.filter(c => c.type === 'content')
    expect(contentChunks.length).toBe(0)
  })

  test('Streaming with validation allow - executes normally', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'allow'
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    const chunks: LlmChunk[] = []
    const stream = openai.generate(openai.buildModel('model'), messages, { toolExecutionValidation: validator })

    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // Validator should have been called
    expect(validator).toHaveBeenCalled()
    // Plugin SHOULD have executed
    expect(Plugin2.prototype.execute).toHaveBeenCalled()

    // Find tool chunks
    const toolChunks = chunks.filter(c => c.type === 'tool')
    expect(toolChunks.length).toBeGreaterThan(0)

    // Last tool chunk should be completed
    const lastToolChunk = toolChunks[toolChunks.length - 1]
    expect(lastToolChunk).toMatchObject({
      type: 'tool',
      name: 'plugin2',
      state: 'completed',
      done: true
    })

    // Should get final response
    const contentChunks = chunks.filter(c => c.type === 'content')
    expect(contentChunks.length).toBeGreaterThan(0)
  })
})

describe('Non-streaming validation integration tests', () => {

  test('Chat with validation deny - throws error', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'deny',
      extra: { reason: 'Not allowed' }
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    await expect(
      openai.complete(openai.buildModel('model'), messages, { toolExecutionValidation: validator })
    ).rejects.toThrow('Tool execution was canceled')

    expect(validator).toHaveBeenCalled()
    expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
  })

  test('Chat with validation abort - throws LlmChunkToolAbort', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'abort',
      extra: { reason: 'Security violation' }
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    try {
      await openai.complete(openai.buildModel('model'), messages, { toolExecutionValidation: validator })
      expect.fail('Should have thrown')
    } catch (error: any) {
      expect(validator).toHaveBeenCalled()
      expect(Plugin2.prototype.execute).not.toHaveBeenCalled()

      // Should be LlmChunkToolAbort
      expect(error).toMatchObject({
        type: 'tool_abort',
        name: 'plugin2',
        params: {},
        reason: {
          decision: 'abort',
          extra: { reason: 'Security violation' }
        }
      })
    }
  })

  test('Chat with validation allow - executes normally', async () => {
    const openai = new OpenAI(config)
    openai.addPlugin(new Plugin2())

    const validator = vi.fn().mockResolvedValue({
      decision: 'allow'
    })

    const messages = [
      new Message('system', 'instructions'),
      new Message('user', 'prompt1'),
    ]

    const response = await openai.complete(openai.buildModel('model'), messages, { toolExecutionValidation: validator })

    expect(validator).toHaveBeenCalled()
    expect(Plugin2.prototype.execute).toHaveBeenCalled()
    expect(response).toMatchObject({
      type: 'text',
      content: 'final response'
    })
  })
})
