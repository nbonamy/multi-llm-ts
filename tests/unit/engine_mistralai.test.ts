
import { LlmChunkContent, LlmChunkTool } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import MistralAI, { MistralStreamingContext } from '../../src/providers/mistralai'
import { Mistral } from '@mistralai/mistralai'
import { CompletionEvent } from '@mistralai/mistralai/models/components'
import { loadMistralAIModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { z } from 'zod'

Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@mistralai/mistralai', async() => {
  const Mistral = vi.fn()
  Mistral.prototype.options$ = {
    apiKey: '123'
  }
  Mistral.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model2', description: 'model2', created: 2, capabilities: { completionChat: true, functionCalling: true } },
        { id: 'magistral6', description: 'Magistral', created: 6, capabilities: { completionChat: true, functionCalling: false } },
        { id: 'model1', description: 'model1', created: 1 },
        { id: 'model8', description: 'model8', created: 8, capabilities: { completionChat: false, functionCalling: false } },
        { id: 'model5', description: 'model5', created: 5, capabilities: { completionChat: true, vision: true } },
        { id: 'model3', description: 'model3', created: 3, capabilities: { completionChat: true, functionCalling: false, vision: true } },
        { id: 'model-4', name: 'model-4', created: 4, aliases: ['model-4-latest', 'model-4-previous'], capabilities: { completionChat: true, functionCalling: true, vision: true } },
        { id: 'model-4-latest', name: 'model-4-latest', created: 4, aliases: ['model-4', 'model-4-previous'], capabilities: { completionChat: true, functionCalling: true, vision: true } },
        { id: 'model-4-previous', name: 'model-4-previous', created: 4, aliases: ['model-4-latest', 'model-4'], capabilities: { completionChat: true, functionCalling: true, vision: true } },
      ] }
    })
  }
  Mistral.prototype.chat = {
    complete: vi.fn(() => {
      return { choices: [ { message: { content: 'response' } } ] }
    }),
    stream: vi.fn(() => {
      return {
        async * [Symbol.asyncIterator]() {

          // first we yield tool call chunks for multiple tools
          // First tool call: plugin1 with empty args (index 0)
          yield { data: { choices: [{ delta: { toolCalls: [ { index: 0, id: '1', function: { name: 'plugin1', arguments: '[]' }} ] }, finishReason: 'none' } ] } }

          // Second tool call: plugin2 with args split across chunks (index 1)
          yield { data: { choices: [{ delta: { toolCalls: [ { index: 1, id: '2', function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finishReason: 'none' } ] } }
          yield { data: { choices: [{ delta: { toolCalls: [ { index: 1, function: { arguments: 'g" ]' } }] }, finishReason: 'none' } ] } }

          // Finish reason to trigger processing of both accumulated tools
          yield { data: { choices: [{ finishReason: 'tool_calls' } ] } }

          // now the text response
          const content = 'response'
          for (let i = 0; i < content.length; i++) {
            yield { data: { choices: [{ delta: { content: content[i], }, finishReason: 'none' }] } }
          }
          yield { data: { choices: [{ delta: { content: '' }, finishReason: 'done' }] } }
        },
        controller: {
          abort: vi.fn()
        }
      }
    })
  }
  return { Mistral }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks();
  config = {
    apiKey: '123',
  }
})

test('MistralAI Load Models', async () => {
  const models = await loadMistralAIModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'magistral6', name: 'Magistral6', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: true, caching: false } },
    { id: 'model5', name: 'Model5', meta: expect.any(Object), capabilities: { tools: false, vision: true, reasoning: false, caching: false } },
    { id: 'model-4-latest', name: 'Model 4 Latest', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false, caching: false } },
    { id: 'model3', name: 'Model3', meta: expect.any(Object), capabilities: { tools: false, vision: true, reasoning: false, caching: false } },
    { id: 'model2', name: 'Model2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(await loadModels('mistralai', config)).toStrictEqual(models)
})

test('MistralAI Basic', async () => {
  const mistralai = new MistralAI(config)
  expect(mistralai.getName()).toBe('mistralai')
})

test('MistralAI buildMistralPayload', async () => {
  const mistralai = new MistralAI(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  const payload = mistralai.buildMistralPayload(mistralai.buildModel('mistral-large'), [ message ])
  expect(payload).toStrictEqual([{ role: 'user', content: [{ type: 'text', text: 'text' }] }])
})

test('MistralAI buildMistralPayload with tool calls', async () => {
  const mistralai = new MistralAI(config)
  const message = new Message('assistant', 'text', undefined, [
    { id: 'tool1', function: 'plugin2', args: { param: 'value' }, result: { result: 'ok' } }
  ])
  expect(mistralai.buildMistralPayload(mistralai.buildModel('mistral-large'), [ message ])).toStrictEqual([
    { role: 'assistant', prefix: false, toolCalls: [
      { id: 'tool1', index: 0, function: { name: 'plugin2', arguments: '{"param":"value"}' } }
    ] },
    { role: 'tool', toolCallId: 'tool1', name: 'plugin2', content: '{"result":"ok"}' },
    { role: 'assistant', content: 'text' }
  ])
})

test('MistralAI completion', async () => {
  const mistralai = new MistralAI(config)
  const response = await mistralai.complete(mistralai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(Mistral.prototype.chat.complete).toHaveBeenCalledWith({
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

test('MistralAI processNativeChunk Text', async () => {
  const mistralai = new MistralAI(config)
  const streamChunk: CompletionEvent = { data: {
    id: '1', model: '',
    choices: [{
      index: 0, delta: { content: 'response' }, finishReason: null
    }],
  }}
  const context: LlmStreamingContextTools = {
    model: mistralai.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
  for await (const llmChunk of mistralai.processNativeChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.data.choices[0].delta.content = null
  streamChunk.data.choices[0].finishReason = 'stop'
  for await (const llmChunk of mistralai.processNativeChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('MistralAI stream with tools', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1())
  mistralai.addPlugin(new Plugin2())
  mistralai.addPlugin(new Plugin3())
  const { stream, context } = await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: true },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(Mistral.prototype.chat.stream).toHaveBeenNthCalledWith(1, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    toolChoice: 'auto',
    tools: expect.any(Array),
  })
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg: LlmChunkContent|null = null
  const toolCalls: LlmChunkTool[] = []
  for await (const chunk of stream) {
    for await (const msg of mistralai.processNativeChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(Mistral.prototype.chat.stream).toHaveBeenNthCalledWith(2, expect.objectContaining({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', content: '', toolCalls: [
        { id: '1', function: { name: 'plugin1', arguments: '[]' } },
      ] },
      { role: 'tool', toolCallId: '1', name: 'plugin1', content: '"result1"' },
      { role: 'assistant', content: '', toolCalls: [
        { id: '2', function: { name: 'plugin2', arguments: '[ "arg" ]' } }
      ] },
      { role: 'tool', toolCallId: '2', name: 'plugin2', content: '"result2"' }
    ],
    toolChoice: 'auto',
    tools: expect.any(Array),
  }))
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
  await mistralai.stop()
  //expect(Mistral.prototype.abort).toHaveBeenCalled()
})

test('MistralAI stream tool choice option', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1())
  await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: true },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'none' } })
  expect(Mistral.prototype.chat.stream).toHaveBeenLastCalledWith(expect.objectContaining({
    toolChoice: 'none',
  }))
  await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: true },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'required' } })
  expect(Mistral.prototype.chat.stream).toHaveBeenLastCalledWith(expect.objectContaining({
    toolChoice: 'required',
  }))
  const { stream, context } = await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: true },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { toolChoice: { type: 'tool', name: 'plugin1' } })
  expect(Mistral.prototype.chat.stream).toHaveBeenLastCalledWith(expect.objectContaining({
    toolChoice: { type: 'function', function: { name: 'plugin1' } },
  }))
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const chunk of stream) { for await (const msg of mistralai.processNativeChunk(chunk, context)) {/* empty */ } }
  expect(Mistral.prototype.chat.stream).toHaveBeenLastCalledWith(expect.objectContaining({
    toolChoice: 'auto',
  }))
})

test('MistralAI stream without tools', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1())
  mistralai.addPlugin(new Plugin2())
  mistralai.addPlugin(new Plugin3())
  const { stream } = await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: false },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(Mistral.prototype.chat.stream).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    topP: 4,
  })
  expect(stream).toBeDefined()
})

test('MistralAI stream without tools', async () => {
  const mistralai = new MistralAI(config)
  const { stream } = await mistralai.stream({
    id: 'model', name: 'model', capabilities: mistralai.getModelCapabilities({
      id: 'model', capabilities: { functionCalling: true },
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { tools: false })
  expect(Mistral.prototype.chat.stream).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
  })
  expect(stream).toBeDefined()
})

test('MistralAI structured output', async () => {
  const mistralai = new MistralAI(config)
  await mistralai.stream(mistralai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(Mistral.prototype.chat.stream.mock.calls[0][0].responseFormat).toStrictEqual({
    type: 'json_object',
  })
})

test('MistralAI streaming validation deny - yields canceled chunk', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Policy violation' }
  })

  const chunks: any[] = []
  const context: LlmStreamingContextTools = {
    model: mistralai.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason
  const toolCallChunk: CompletionEvent = { data: { id: '1', model: '', choices: [{ index: 0, delta: {}, finishReason: 'tool_calls' }] } }
  for await (const chunk of mistralai.processNativeChunk(toolCallChunk, context)) {
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

test('MistralAI streaming validation abort - yields tool_abort chunk', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  const chunks: any[] = []
  const context: LlmStreamingContextTools = {
    model: mistralai.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [{ id: '1', function: 'plugin2', args: '{}', message: [] }],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Simulate tool_calls finish_reason - abort throws, so we need to catch it
  const toolCallChunk: CompletionEvent = { data: { id: '1', model: '', choices: [{ index: 0, delta: {}, finishReason: 'tool_calls' }] } }
  try {
    for await (const chunk of mistralai.processNativeChunk(toolCallChunk, context)) {
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

test('MistralAI chat validation deny - throws error', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(Mistral.prototype.chat.complete).mockImplementationOnce(() => Promise.resolve({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        toolCalls: [{
          id: 'tool_1',
          type: 'function',
          function: { name: 'plugin2', arguments: '{}' }
        }]
      },
      finishReason: 'tool_calls'
    }]
  }) as any)

  await expect(
    mistralai.complete(mistralai.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
  ).rejects.toThrow('Tool execution was canceled')

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('MistralAI chat validation abort - throws LlmChunkToolAbort', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(Mistral.prototype.chat.complete).mockImplementationOnce(() => Promise.resolve({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        toolCalls: [{
          id: 'tool_1',
          type: 'function',
          function: { name: 'plugin2', arguments: '{}' }
        }]
      },
      finishReason: 'tool_calls'
    }]
  }) as any)

  try {
    await mistralai.complete(mistralai.buildModel('model'), [
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

test('MistralAI syncToolHistoryToThread updates thread from toolHistory', () => {
  const mistralai = new MistralAI(config)

  // MistralAI uses camelCase: toolCallId (not tool_call_id like OpenAI)
  const context: MistralStreamingContext = {
    model: mistralai.buildModel('model'),
    thread: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'call_1', name: 'test_tool', content: JSON.stringify({ original: 'result' }) },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_2', type: 'function', function: { name: 'test_tool', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 'call_2', name: 'test_tool', content: JSON.stringify({ original: 'result2' }) },
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
  mistralai.syncToolHistoryToThread(context)

  // Verify thread was updated (note: MistralAI uses toolCallId not tool_call_id)
  const toolMessage1 = context.thread.find((m: any) => m.role === 'tool' && m.toolCallId === 'call_1') as any
  const toolMessage2 = context.thread.find((m: any) => m.role === 'tool' && m.toolCallId === 'call_2') as any

  expect(toolMessage1.content).toBe(JSON.stringify({ modified: 'truncated' }))
  expect(toolMessage2.content).toBe(JSON.stringify({ modified: 'truncated2' }))
})

test('MistralAI addHook and hook execution', async () => {
  const mistralai = new MistralAI(config)

  const hookCallback = vi.fn()
  const unsubscribe = mistralai.addHook('beforeToolCallsResponse', hookCallback)

  const context: MistralStreamingContext = {
    model: mistralai.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: { data: 'original' }, round: 0 }],
    currentRound: 1,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // @ts-expect-error accessing protected method for testing
  await mistralai.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).toHaveBeenCalledWith(context)

  // Test unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // @ts-expect-error accessing protected method for testing
  await mistralai.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).not.toHaveBeenCalled()
})

test('MistralAI hook modifies tool results before second API call', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1())
  mistralai.addPlugin(new Plugin2())

  // Register hook that only truncates plugin1 result (not plugin2)
  mistralai.addHook('beforeToolCallsResponse', (context) => {
    for (const entry of context.toolHistory) {
      if (entry.name === 'plugin1') {
        entry.result = '[truncated]'
      }
    }
  })

  const { stream, context } = await mistralai.stream(mistralai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream to trigger tool execution and second API call
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of mistralai.processNativeChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify second API call has truncated plugin1 but original plugin2
  // MistralAI uses camelCase: toolCallId (not tool_call_id like OpenAI)
  expect(Mistral.prototype.chat.stream).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'tool', toolCallId: '1', content: '"[truncated]"' }),
      expect.objectContaining({ role: 'tool', toolCallId: '2', content: '"result2"' }),
    ])
  }))
})

test('MistralAI stream preserves text content before tool calls', async () => {
  // Override mock to emit text BEFORE tool calls
  vi.mocked(Mistral.prototype.chat.stream).mockImplementationOnce(() => ({
    async * [Symbol.asyncIterator]() {
      // First: text content (model explains what it's about to do)
      yield { data: { choices: [{ delta: { content: 'Let me search ' }, finishReason: null }] } }
      yield { data: { choices: [{ delta: { content: 'for that.' }, finishReason: null }] } }

      // Then: tool call
      yield { data: { choices: [{ delta: { toolCalls: [{ id: 'tool-1', function: { name: 'plugin1', arguments: '[]' } }] }, finishReason: null }] } }

      // Finish reason to trigger tool execution
      yield { data: { choices: [{ finishReason: 'tool_calls' }] } }

      // After tool execution, final response
      yield { data: { choices: [{ delta: { content: 'Done!' }, finishReason: 'stop' }] } }
    }
  }) as any)

  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1())

  const { stream, context } = await mistralai.stream(mistralai.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of mistralai.processNativeChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify the second API call includes text content in the assistant message
  // MistralAI uses camelCase and 'content' field in assistant messages
  expect(Mistral.prototype.chat.stream).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'Let me search for that.',
        toolCalls: expect.any(Array)
      })
    ])
  }))
})