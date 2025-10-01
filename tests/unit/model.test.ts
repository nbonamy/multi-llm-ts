
import { expect, Mock, test, vi } from 'vitest'
import LlmEngine from '../../src/engine'
import { defaultCapabilities } from '../../src/index'
import LlmModel from '../../src/model'
import Message from '../../src/models/message'
import { Plugin } from '../../src/plugin'
import { ChatModel } from '../../src/types'
import { LlmChunk, LlmResponse } from '../../src/types/llm'

// Mock LlmEngine
const createMockEngine = () => {
  const mockEngine = {
    plugins: [],
    clearPlugins: vi.fn(),
    addPlugin: vi.fn(),
    complete: vi.fn(),
    generate: vi.fn(),
  }
  return mockEngine as unknown as LlmEngine
}

// Mock Plugin
class TestPlugin extends Plugin {
  getName(): string { return 'test' }
  getDescription(): string { return 'test plugin' }
  getPreparationDescription(): string { return 'preparing' }
  getRunningDescription(): string { return 'running' }
  getParameters(): any[] { return [] }
  async execute(): Promise<any> { return 'result' }
}

test('Constructor with string model', () => {
  const mockEngine = createMockEngine()
  const model = new LlmModel(mockEngine, 'gpt-4')

  expect(model.engine).toBe(mockEngine)
  expect(model.model).toBe('gpt-4')
})

test('Constructor with ChatModel object', () => {
  const mockEngine = createMockEngine()
  const chatModel: ChatModel = {
    id: 'gpt-4',
    name: 'GPT-4',
    meta: undefined,
    ...defaultCapabilities
  }
  const model = new LlmModel(mockEngine, chatModel)

  expect(model.engine).toBe(mockEngine)
  expect(model.model).toBe(chatModel)
})

test('plugins getter delegates to engine', () => {
  const mockEngine = createMockEngine()
  const testPlugin = new TestPlugin()
  mockEngine.plugins = [testPlugin]

  const model = new LlmModel(mockEngine, 'gpt-4')

  expect(model.plugins).toBe(mockEngine.plugins)
  expect(model.plugins).toHaveLength(1)
  expect(model.plugins[0]).toBe(testPlugin)
})

test('clearPlugins calls engine method', () => {
  const mockEngine = createMockEngine()
  const model = new LlmModel(mockEngine, 'gpt-4')

  model.clearPlugins()

  expect(mockEngine.clearPlugins).toHaveBeenCalledTimes(1)
})

test('addPlugin calls engine method with plugin', () => {
  const mockEngine = createMockEngine()
  const model = new LlmModel(mockEngine, 'gpt-4')
  const testPlugin = new TestPlugin()

  model.addPlugin(testPlugin)

  expect(mockEngine.addPlugin).toHaveBeenCalledTimes(1)
  expect(mockEngine.addPlugin).toHaveBeenCalledWith(testPlugin)
})

test('complete calls engine.complete with model and parameters', async () => {
  const mockEngine = createMockEngine()
  const mockResponse: LlmResponse = {
    type: 'text',
    content: 'response'
  }
  ;(mockEngine.complete as Mock).mockResolvedValue(mockResponse)

  const model = new LlmModel(mockEngine, 'gpt-4')
  const messages = [new Message('user', 'Hello')]
  const opts = { temperature: 0.7 }

  const result = await model.complete(messages, opts)

  expect(mockEngine.complete).toHaveBeenCalledTimes(1)
  expect(mockEngine.complete).toHaveBeenCalledWith('gpt-4', messages, opts)
  expect(result).toBe(mockResponse)
})

test('complete calls engine.complete with ChatModel object', async () => {
  const mockEngine = createMockEngine()
  const mockResponse: LlmResponse = {
    type: 'text',
    content: 'response'
  }
  ;(mockEngine.complete as Mock).mockResolvedValue(mockResponse)

  const chatModel: ChatModel = {
    id: 'gpt-4',
    name: 'GPT-4',
    meta: undefined,
    ...defaultCapabilities
  }
  const model = new LlmModel(mockEngine, chatModel)
  const messages = [new Message('user', 'Hello')]

  const result = await model.complete(messages)

  expect(mockEngine.complete).toHaveBeenCalledTimes(1)
  expect(mockEngine.complete).toHaveBeenCalledWith(chatModel, messages, undefined)
  expect(result).toBe(mockResponse)
})

test('generate yields chunks from engine.generate', async () => {
  const mockEngine = createMockEngine()
  const mockChunks: LlmChunk[] = [
    { type: 'content', text: 'Hello', done: false },
    { type: 'content', text: ' world', done: true },
  ]

  // Mock async generator
  ;(mockEngine.generate as Mock).mockReturnValue((async function* () {
    for (const chunk of mockChunks) {
      yield chunk
    }
  })())

  const model = new LlmModel(mockEngine, 'gpt-4')
  const messages = [new Message('user', 'Hello')]
  const opts = { temperature: 0.7 }

  const chunks: LlmChunk[] = []
  for await (const chunk of model.generate(messages, opts)) {
    chunks.push(chunk)
  }

  expect(mockEngine.generate).toHaveBeenCalledTimes(1)
  expect(mockEngine.generate).toHaveBeenCalledWith('gpt-4', messages, opts)
  expect(chunks).toEqual(mockChunks)
})

test('generate without options', async () => {
  const mockEngine = createMockEngine()
  const mockChunks: LlmChunk[] = [
    { type: 'content', text: 'Response', done: true },
  ]

  ;(mockEngine.generate as Mock).mockReturnValue((async function* () {
    for (const chunk of mockChunks) {
      yield chunk
    }
  })())

  const model = new LlmModel(mockEngine, 'gpt-4')
  const messages = [new Message('user', 'Test')]

  const chunks: LlmChunk[] = []
  for await (const chunk of model.generate(messages)) {
    chunks.push(chunk)
  }

  expect(mockEngine.generate).toHaveBeenCalledTimes(1)
  expect(mockEngine.generate).toHaveBeenCalledWith('gpt-4', messages, undefined)
  expect(chunks).toEqual(mockChunks)
})
