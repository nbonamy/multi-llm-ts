import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test, beforeAll } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadLMStudioModels, loadModels } from '../../src/llm'
import Message from '../../src/models/message'
import LMStudio from '../../src/providers/lmstudio'
import { LlmChunk } from '../../src/types/llm'
import { Chat, LLMActionOpts, LMStudioClient, LMStudioClientConstructorOpts, Tool, ToolCallContext } from '@lmstudio/sdk'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@lmstudio/sdk', async () => {
  
  const mockAct = vi.fn(async (chat: Chat, tools: Tool[], opts?: LLMActionOpts) => {

    if (!opts?.onMessage) return
      
    if (tools && tools.length > 0) {

      opts.onToolCallRequestNameReceived?.(0, 0, 'plugin2')

      opts.onMessage({
        getRole: () => 'assistant',
        getText: () => '',
        getToolCallRequests: () => [
          {
            id: '0',
            type: 'function',
            name: 'plugin2',
            arguments: ['arg'],
          }
        ],
        getToolCallResults: () => [],
        isAssistantMessage: () => true,
      } as any)

      // Actually call the plugin's execute (simulate)
      const result = await tools[1].implementation(['arg'] as any, {} as ToolCallContext)

      // 3. Tool result message
      opts.onMessage({
        getRole: () => 'assistant',
        getText: () => '',
        getToolCallRequests: () => [],
        getToolCallResults: () => [
          {
            toolCallId: '0',
            content: result,
          }
        ],
        isAssistantMessage: () => true,
      } as any)

    }

    // now the text response
    opts.onMessage({
      getRole: () => 'assistant',
      getText: () => 'response',
      getToolCallRequests: () => [],
      getToolCallResults: () => [],
      isAssistantMessage: () => true,
    } as any)

    // done
    return Promise.resolve()

  })

  const LMStudioClient = vi.fn((opts: LMStudioClientConstructorOpts) => {
    LMStudioClient.prototype.baseURL = opts.baseUrl
  })
  
  LMStudioClient.prototype.llm = {
    model: vi.fn((id?: string): any => {
      if (!id) {
        return {
          identifier: 'llama-3.2',
          displayName: 'Llama 3.0',
          trainedForToolUse: true,
          vision: false,
        }
      }

      return {
        act: mockAct
      }
    })
  }

  // Store the mock act function so it can be accessed in tests
  LMStudioClient.prototype.llm.model.act = mockAct
  
  return {
    LMStudioClient,
    Chat: {
      from: vi.fn(payload => payload)
    },
    ChatMessage: {
      create: vi.fn((role, content) => {
        return {
          getRole: () => role,
          getText: () => content,
        }
      })
    }
  }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

beforeAll(() => {
  // Mock AbortController globally so .abort is a spy
  global.AbortController = vi.fn(() => ({
    signal: {},
    abort: vi.fn(),
  })) as any
})

test('LMStudio Load Chat Models', async () => {
  const models = await loadLMStudioModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'llama-3.2', name: 'Llama 3.0', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false, caching: false } },
  ])
  expect(models!.image).toStrictEqual([])
  expect(await loadModels('lmstudio', config)).toStrictEqual(models)
})

test('LMStudio Basic', async () => {
  const lmstudio = new LMStudio (config)
  expect(lmstudio.getName()).toBe('lmstudio')
})

test('LMStudio completion', async () => {
  const lmstudio = new LMStudio (config)
  const response = await lmstudio.complete(lmstudio.buildModel('llama-3.2'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  // @ts-expect-error mocking
  expect(LMStudioClient.prototype.llm.model.act).toHaveBeenLastCalledWith(
    [ { role: 'system', content: 'instruction' }, { role: 'user', content: 'prompt' }, ],
    [],
    expect.objectContaining({
      onMessage: expect.any(Function),
    })
  )
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response',
    toolCalls: [],
  })
})

test('LMStudio stream', async () => {
  const lmstudio = new LMStudio (config)
  lmstudio.addPlugin(new Plugin1())
  lmstudio.addPlugin(new Plugin2())
  lmstudio.addPlugin(new Plugin3())
  const { stream, context } = await lmstudio.stream({
    id: 'llama-3.2', name: 'llama-3.2', capabilities: lmstudio.getModelCapabilities({
      id: 'llama-3.2',
      name: 'llama-3.2',
      trainedForToolUse: true,
      vision: false,
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  // @ts-expect-error mocking
  expect(LMStudioClient.prototype.llm.model.act).toHaveBeenLastCalledWith(
    [ { role: 'system', content: 'instruction' }, { role: 'user', content: 'prompt' }, ],
    [ expect.objectContaining({
      implementation: expect.any(Function),
    }), expect.objectContaining({
      implementation: expect.any(Function),
    }) ],
    expect.objectContaining({
      onMessage: expect.any(Function),
    })
  )
  expect(stream).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of lmstudio.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'llama-3.2' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: '0', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: '0', name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: '0', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, status: undefined, done: true })
  await lmstudio.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('LMStudio stream without tools', async () => {
  const lmstudio = new LMStudio (config)
  const { stream } = await lmstudio.stream(lmstudio.buildModel('llama-3.2'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  // @ts-expect-error mocking
  expect(LMStudioClient.prototype.llm.model.act).toHaveBeenLastCalledWith(
    [ { role: 'system', content: 'instruction' }, { role: 'user', content: 'prompt' }, ],
    [],
    expect.objectContaining({
      onMessage: expect.any(Function),
    })
  )
  expect(stream).toBeDefined()
})
