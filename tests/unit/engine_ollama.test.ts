
import { LlmChunkContent, LlmChunkTool } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama, { OllamaStreamingContext } from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadModels, loadOllamaModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { z } from 'zod'
import { ChatResponse } from 'ollama'

Plugin1.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result1'))
Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('ollama/dist/browser.cjs', async() => {
  const Ollama = vi.fn()
  Ollama.prototype.list = vi.fn(() => {
    return { models: [
      { model: 'model:7b', name: 'model' },
      { model: 'gemma3:latest', name: 'gemma3' },
      { model: 'cogito:latest', name: 'cogito' },
      { model: 'embed:latest', name: 'embed' },
    ] }
  })
  Ollama.prototype.pull = vi.fn()
  Ollama.prototype.delete = vi.fn()
  Ollama.prototype.show = vi.fn(({ model: model}) => {
    if (model === 'embed:latest') {
      return {
        details: { family: 'bert' },
        model_info: {}
      }
    } else {
      return {
        details: { family: 'llm' },
        model_info: {},
        capabilities: model === 'model:7b' ? ['tools'] : [],
      }
    }
  })
  Ollama.prototype.chat = vi.fn((opts) => {
    if (opts.stream) {
      return {
        async * [Symbol.asyncIterator]() {

          // first we yield tool call chunks for multiple tools
          if (opts.model.includes('tool')) {
            yield { message: { role: 'assistant', content: '', tool_calls: [
              { function: { name: 'plugin1', arguments: [] } },
              { function: { name: 'plugin2', arguments: ['arg'] } }
            ], done: false } }
          }
          
          // yield some reasoning (legacy)
          const reasoning = 'reasoning'
          yield { message: { role: 'assistant', content: '<think>' }, done: false }
          for (let i = 0; i < reasoning.length; i++) {
            yield { message: { role: 'assistant', content: reasoning[i] }, done: false }
          }
          yield { message: { role: 'assistant', content: '</think>' }, done: false }

          // yield some thinking (new)
          const thinking = '+thinking'
          for (let i = 0; i < thinking.length; i++) {
            yield { message: { role: 'assistant', content: '', thinking: thinking[i] }, done: false }
          }

          // now the text response
          const content = 'response'
          for (let i = 0; i < content.length; i++) {
            yield { message: { role: 'assistant', content: content[i] }, done: false }
          }
          yield { message: { role: 'assistant', content: '' }, done: true }
        },
        controller: {
          abort: vi.fn()
        }
      }
    }
    else {
      return { message: { content: 'response' } }
    }
  })
  Ollama.prototype.abort = vi.fn()
  return { Ollama: Ollama }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks();
  config = {
    apiKey: '123',
  }
})

test('Ollama Load Models', async () => {
  const models = await loadOllamaModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'cogito:latest', name: 'cogito', meta: { model: 'cogito:latest', name: 'cogito' }, capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
    { id: 'gemma3:latest', name: 'gemma3', meta: { model: 'gemma3:latest', name: 'gemma3' }, capabilities: { tools: false, vision: true, reasoning: false, caching: false } },
    { id: 'model:7b', name: 'model', meta: { model: 'model:7b', name: 'model' }, capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'embed:latest', name: 'embed', meta: { model: 'embed:latest', name: 'embed' }, capabilities: { tools: false, vision: false, reasoning: false, caching: false } },
  ])
  expect(await loadModels('ollama', config)).toStrictEqual(models)
})

test('Ollama Basic', async () => {
  const ollama = new Ollama(config)
  expect(ollama.getName()).toBe('ollama')
})

test('Ollama buildOllamaPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(ollama.buildOllamaPayload(ollama.buildModel('llama:latest'), [ message ])).toStrictEqual([ { role: 'user', content: 'text' } ])
  expect(ollama.buildOllamaPayload(ollama.buildModel('llava:latest'), [ message ])).toStrictEqual([ { role: 'user', content: 'text', images: [ 'image' ] }])
})

test('Ollama buildOllamaPayload with tool calls', async () => {
  const ollama = new Ollama(config)
  const message = new Message('assistant', 'text', undefined, [
    { id: 'tool1', function: 'plugin2', args: { param: 'value' }, result: { result: 'ok' } }
  ])
  expect(ollama.buildOllamaPayload(ollama.buildModel('llama:latest'), [ message ])).toStrictEqual([
    { role: 'assistant', content: 'text', tool_calls: [
      { id: 'tool1', function: { index: 0, name: 'plugin2', arguments: { param: "value" } } }
    ] },
    { role: 'tool', content: '{"result":"ok"}' },
  ])
})

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete(ollama.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8, think: 'medium' })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    options: { temperature : 0.8 },
    think: 'medium',
    stream: false,
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response',
    toolCalls: [],
  })
})

test('Ollama stream without tools', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  const { stream, context } = await ollama.stream(ollama.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    options: { top_k: 4 },
    stream: true,
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let reasoning = ''
  const toolCalls: LlmChunkTool[] = []
  let lastMsg: LlmChunkContent|null = null
  for await (const chunk of stream) {
    for await (const msg of ollama.processNativeChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'reasoning') reasoning += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg!.done).toBe(true)
  expect(response).toBe('response')
  expect(reasoning).toBe('reasoning+thinking')
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama stream with tools', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  const { stream, context } = await ollama.stream(ollama.buildModel('llama3-groq-tool-use'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenNthCalledWith(1, {
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    //tool_choice: 'auto',
    tools: expect.any(Array),
    options: { top_k: 4 },
    stream: true,
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  const toolCalls: LlmChunkTool[] = []
  let lastMsg: LlmChunkContent|null = null
  for await (const chunk of stream) {
    for await (const msg of ollama.processNativeChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_ollama.Ollama.prototype.chat).toHaveBeenNthCalledWith(2, {
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
      { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'plugin1', arguments: [] } },
      ] },
      { role: 'tool', content: '"result1"' },
      { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'plugin2', arguments: ['arg'] } }
      ] },
      { role: 'tool', content: '"result2"' },
    ],
    //tool_choice: 'auto',
    tools: expect.any(Array),
    options: { top_k: 4 },
    stream: true,
  })
  expect(lastMsg!.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin1.prototype.execute).toHaveBeenCalledWith({ model: 'llama3-groq-tool-use' }, [])
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'llama3-groq-tool-use' }, ['arg'])

  // Verify tool call sequence: preparing for both tools, then running, then completed
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/0-.*/), name: 'plugin1', state: 'preparing', status: 'prep1', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/0-.*/), name: 'plugin1', state: 'running', status: 'run1 with []', call: { params: [], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/0-.*/), name: 'plugin1', state: 'completed', call: { params: [], result: 'result1' }, status: undefined, done: true })
  expect(toolCalls[3]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/1-.*/), name: 'plugin2', state: 'preparing', status: 'prep2', done: false })
  expect(toolCalls[4]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/1-.*/), name: 'plugin2', state: 'running', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[5]).toStrictEqual({ type: 'tool', id: expect.stringMatching(/1-.*/), name: 'plugin2', state: 'completed', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama stream with tools disabled', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  await ollama.stream(ollama.buildModel('llama3-groq-tool-use'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, tools: false })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    options: { top_k: 4 },
    stream: true,
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Ollama stream without tools and options', async () => {
  const ollama = new Ollama(config)
  const { stream } = await ollama.stream(ollama.buildModel('llama3-groq-tool-use'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { contextWindowSize: 4096, top_p: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    stream: true,
    options: {
      num_ctx: 4096,
      top_p: 4,
    }
  })
  expect(stream).toBeDefined()
})

test('Ollama structured output', async () => {
  const ollama = new Ollama(config)
  await ollama.stream(ollama.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { structuredOutput: { name: 'test', structure: z.object({}) } })
  // @ts-expect-error mock
  expect(_ollama.Ollama.prototype.chat.mock.calls[0][0].format).toMatchObject({
    $ref: expect.any(String),
    $schema: expect.any(String),
    definitions: expect.any(Object),
  })
})

test('Ollama processNativeChunk Text', async () => {
  const ollama = new Ollama(config)
  const streamChunk: any = {
    message: { content: 'response'},
    done: false
  }
  const context: OllamaStreamingContext = {
    model: ollama.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }
  for await (const llmChunk of ollama.processNativeChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.done = true
  streamChunk.message.content = null
  for await (const llmChunk of ollama.processNativeChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Ollama pull model', async () => {
  const ollama = new Ollama(config)
  await ollama.pullModel('model')
  expect(_ollama.Ollama.prototype.pull).toHaveBeenCalledWith({ model: 'model', stream: true })
})

test('Ollama delete model', async () => {
  const ollama = new Ollama(config)
  await ollama.deleteModel('model')
  expect(_ollama.Ollama.prototype.delete).toHaveBeenCalledWith({ model: 'model' })
})

test('Ollama streaming validation deny - yields canceled chunk', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Policy violation' }
  })

  const chunks: any[] = []
  const context: OllamaStreamingContext = {
    model: ollama.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Simulate tool_calls - need to pass chunk with tool_calls
  const toolCallChunk = { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'plugin2', arguments: {} } }], done: false } }
  for await (const chunk of ollama.processNativeChunk(toolCallChunk as unknown as ChatResponse, context)) {
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

test('Ollama streaming validation abort - yields tool_abort chunk', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  const chunks: any[] = []
  const context: OllamaStreamingContext = {
    model: ollama.buildModel('model'),
    thread: [],
    opts: { toolExecutionValidation: validator },
    toolCalls: [],
    toolHistory: [],
    currentRound: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
    thinking: false,
  }

  // Simulate tool_calls - abort throws, so we need to catch it
  const toolCallChunk = { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'plugin2', arguments: {} } }], done: false } }
  try {
    for await (const chunk of ollama.processNativeChunk(toolCallChunk as unknown as ChatResponse, context)) {
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

test('Ollama chat validation deny - throws error', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'deny',
    extra: { reason: 'Not allowed' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_ollama.Ollama.prototype.chat).mockImplementationOnce(() => Promise.resolve({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        function: { name: 'plugin2', arguments: {} }
      }]
    }
  }) as any)

  await expect(
    ollama.complete(ollama.buildModel('model'), [
      new Message('system', 'instruction'),
      new Message('user', 'prompt'),
    ], { toolExecutionValidation: validator })
  ).rejects.toThrow('Tool execution was canceled')

  expect(validator).toHaveBeenCalled()
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Ollama chat validation abort - throws LlmChunkToolAbort', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin2())

  const validator = vi.fn().mockResolvedValue({
    decision: 'abort',
    extra: { reason: 'Security violation' }
  })

  // Mock to return tool calls (use mockImplementationOnce to preserve original mock)
  vi.mocked(_ollama.Ollama.prototype.chat).mockImplementationOnce(() => Promise.resolve({
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        function: { name: 'plugin2', arguments: {} }
      }]
    }
  }) as any)

  try {
    await ollama.complete(ollama.buildModel('model'), [
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

test('Ollama syncToolHistoryToThread updates thread from toolHistory', () => {
  const ollama = new Ollama(config)

  // Ollama uses simple tool format without tool_call_id, matching by name
  const context: OllamaStreamingContext = {
    model: ollama.buildModel('model'),
    thread: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'test_tool', arguments: {} } }] },
      { role: 'tool', content: JSON.stringify({ original: 'result' }) },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'test_tool', arguments: {} } }] },
      { role: 'tool', content: JSON.stringify({ original: 'result2' }) },
    ],
    opts: {},
    toolCalls: [],
    toolHistory: [
      { id: 'call_1', name: 'test_tool', args: {}, result: { modified: 'truncated' }, round: 0 },
      { id: 'call_2', name: 'test_tool', args: {}, result: { modified: 'truncated2' }, round: 1 },
    ],
    currentRound: 2,
    thinking: false,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // Call syncToolHistoryToThread
  ollama.syncToolHistoryToThread(context)

  // Verify thread was updated
  // Ollama matches by index (first tool message matches first toolHistory entry, etc.)
  const toolMessages = context.thread.filter((m: any) => m.role === 'tool') as any[]

  expect(toolMessages[0].content).toBe(JSON.stringify({ modified: 'truncated' }))
  expect(toolMessages[1].content).toBe(JSON.stringify({ modified: 'truncated2' }))
})

test('Ollama addHook and hook execution', async () => {
  const ollama = new Ollama(config)

  const hookCallback = vi.fn()
  const unsubscribe = ollama.addHook('beforeToolCallsResponse', hookCallback)

  const context: OllamaStreamingContext = {
    model: ollama.buildModel('model'),
    thread: [],
    opts: {},
    toolCalls: [],
    toolHistory: [{ id: 'call_1', name: 'test', args: {}, result: { data: 'original' }, round: 0 }],
    currentRound: 1,
    thinking: false,
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }

  // @ts-expect-error accessing protected method for testing
  await ollama.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).toHaveBeenCalledWith(context)

  // Test unsubscribe
  unsubscribe()
  hookCallback.mockClear()

  // @ts-expect-error accessing protected method for testing
  await ollama.callHook('beforeToolCallsResponse', context)

  expect(hookCallback).not.toHaveBeenCalled()
})

test('Ollama hook modifies tool results before second API call', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())

  // Register hook that only truncates plugin1 result (not plugin2)
  ollama.addHook('beforeToolCallsResponse', (context) => {
    for (const entry of context.toolHistory) {
      if (entry.name === 'plugin1') {
        entry.result = '[truncated]'
      }
    }
  })

  // Use model name containing 'tool' to trigger tool call mock (see line 49)
  const { stream, context } = await ollama.stream(ollama.buildModel('model-with-tool'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream to trigger tool execution and second API call
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of ollama.processNativeChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify second API call has truncated plugin1 but original plugin2
  // Ollama uses simple { role: 'tool', content } format without IDs, matched by index
  expect(_ollama.Ollama.prototype.chat).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({ role: 'tool', content: '"[truncated]"' }),
      expect.objectContaining({ role: 'tool', content: '"result2"' }),
    ])
  }))
})

test('Ollama stream preserves text content before tool calls', async () => {
  // Override mock to emit text BEFORE tool calls
  vi.mocked(_ollama.Ollama.prototype.chat).mockImplementationOnce(() => ({
    async * [Symbol.asyncIterator]() {
      // First: text content (model explains what it's about to do)
      yield { message: { role: 'assistant', content: 'Let me search ' }, done: false }
      yield { message: { role: 'assistant', content: 'for that.' }, done: false }

      // Then: tool calls
      yield { message: { role: 'assistant', content: '', tool_calls: [
        { function: { name: 'plugin1', arguments: [] } }
      ] }, done: false }

      // After tool execution, final response
      yield { message: { role: 'assistant', content: 'Done!' }, done: true }
    },
    controller: { abort: vi.fn() }
  }) as any)

  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())

  // Use model name containing 'tool' to enable tools
  const { stream, context } = await ollama.stream(ollama.buildModel('model-with-tool'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])

  // Consume the stream
  for await (const chunk of stream) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const msg of ollama.processNativeChunk(chunk, context)) {
      // just consume
    }
  }

  // Verify the second API call includes text content in the assistant message
  // Ollama tool call assistant messages should include the accumulated text
  expect(_ollama.Ollama.prototype.chat).toHaveBeenNthCalledWith(2, expect.objectContaining({
    messages: expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: 'Let me search for that.',
        tool_calls: expect.any(Array)
      })
    ])
  }))
})
