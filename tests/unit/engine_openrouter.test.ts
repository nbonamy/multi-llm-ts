
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadModels, loadOpenRouterModels } from '../../src/llm'
import OpenRouter from '../../src/providers/openrouter'
import Message from '../../src/models/message'
import OpenAI, { ClientOptions } from 'openai'
import { LlmChunk } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn((opts: ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return {
        data: [
          { id: 'chat1', name: 'chat1', architecture: { input_modalities: [ 'text' ], modality: 'text->text' } },
          { id: 'chat2', name: 'chat2', architecture: { input_modalities: [ 'text', 'image' ], modality: 'text+image->text' }, supported_parameters: ['tools'] },
          { id: 'chat3', name: 'chat3', architecture: { modality: 'text+image->text' }, supported_parameters: ['top_k'] },
          { id: 'image', name: 'image', architecture: { input_modalities: [ 'text' ], modality: 'text->image' } },
        ]
      }
    })
  }
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              
              // first we yield tool call chunks
              yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
              yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
              yield { choices: [{ finish_reason: 'stop' } ] }
              
              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i], finish_reason: 'none' } }] }
              }
              yield { choices: [{ delta: { content: '', finish_reason: 'done' } }] }
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
  return { default : OpenAI }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('OpenRouter Load Chat Models', async () => {
  const models = await loadOpenRouterModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'chat1', name: 'chat1', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
    { id: 'chat2', name: 'chat2', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false } },
    { id: 'chat3', name: 'chat3', meta: expect.any(Object), capabilities: { tools: false, vision: true, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'image', name: 'image', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(await loadModels('openrouter', config)).toStrictEqual(models)
})

test('OpenRouter Basic', async () => {
  const openrouter = new OpenRouter(config)
  expect(openrouter.getName()).toBe('openrouter')
  expect(openrouter.client.apiKey).toBe('123')
  expect(openrouter.client.baseURL).toBe('https://openrouter.ai/api/v1')
})

test('OpenRouter stream', async () => {
  const openrouter = new OpenRouter(config)
  openrouter.addPlugin(new Plugin1())
  openrouter.addPlugin(new Plugin2())
  openrouter.addPlugin(new Plugin3())
  const { stream, context } = await openrouter.stream({
    id: 'model', name: 'model', capabilities: openrouter.getModelCapabilities({
      // @ts-expect-error mock
      architecture: { input_modalities: [ 'text' ] },
      supported_parameters: ['tools'],
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of openrouter.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await openrouter.stop(stream)
  expect(stream.controller!.abort).toHaveBeenCalled()
})

test('OpenRouter stream without tools', async () => {
  const openrouter = new OpenRouter(config)
  const { stream } = await openrouter.stream({
    id: 'model', name: 'model', capabilities: openrouter.getModelCapabilities({
      // @ts-expect-error mock
      architecture: { input_modalities: [ 'text' ] },
      supported_parameters: ['topK'],
    })
  }, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(OpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] }
    ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
})
