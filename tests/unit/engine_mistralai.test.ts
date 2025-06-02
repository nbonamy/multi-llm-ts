
import { LlmChunkContent, LlmChunkTool } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import MistralAI from '../../src/providers/mistralai'
import { Mistral } from '@mistralai/mistralai'
import { CompletionEvent } from '@mistralai/mistralai/models/components'
import { loadMistralAIModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { LlmStreamingContextTools } from '../../src/engine'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@mistralai/mistralai', async() => {
  const Mistral = vi.fn()
  Mistral.prototype.options$ = {
    apiKey: '123'
  }
  Mistral.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model2', name: 'model2', capabilities: { functionCalling: true } },
        { id: 'model6', name: 'model6', capabilities: { functionCalling: false } },
        { id: 'model1', name: 'model1' },
        { id: 'model5', name: 'model4', capabilities: { vision: true } },
        { id: 'model3', name: 'model3', capabilities: { functionCalling: false, vision: true } },
        { id: 'model4', name: 'model4', capabilities: { functionCalling: true, vision: true } },
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
          
          // first we yield tool call chunks
          yield { data: { choices: [{ delta: { toolCalls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finishReason: 'none' } ] } }
          yield { data: { choices: [{ delta: { toolCalls: [ { function: { arguments: [ 'g" ]' ] } }] }, finishReason: 'tool_calls' } ] } }
          
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
    { id: 'model1', name: 'model1', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
    { id: 'model2', name: 'model2', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'model3', name: 'model3', meta: expect.any(Object), capabilities: { tools: false, vision: true, reasoning: false } },
    { id: 'model4', name: 'model4', meta: expect.any(Object), capabilities: { tools: true, vision: true, reasoning: false } },
    { id: 'model5', name: 'model5', meta: expect.any(Object), capabilities: { tools: false, vision: true, reasoning: false } },
    { id: 'model6', name: 'model6', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(await loadModels('mistralai', config)).toStrictEqual(models)
})

test('MistralAI Basic', async () => {
  const mistralai = new MistralAI(config)
  expect(mistralai.getName()).toBe('mistralai')
})

test('MistralAI buildPayload', async () => {
  const mistralai = new MistralAI(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  const payload = mistralai.buildPayload(mistralai.buildModel('mistral-large'), [ message ])
  expect(payload).toStrictEqual([{ role: 'user', content: [{ type: 'text', text: 'text' }] }])
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

test('MistralAI nativeChunkToLlmChunk Text', async () => {
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
  }
  for await (const llmChunk of mistralai.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.data.choices[0].delta.content = null
  streamChunk.data.choices[0].finishReason = 'stop'
  for await (const llmChunk of mistralai.nativeChunkToLlmChunk(streamChunk, context)) {
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
    for await (const msg of mistralai.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(Mistral.prototype.chat.stream).toHaveBeenNthCalledWith(2, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'assistant', toolCalls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "arg" ]' } } ] },
      { role: 'tool', toolCallId: 1, name: 'plugin2', content: '"result2"' }
    ],
    toolChoice: 'auto',
    tools: expect.any(Array),
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await mistralai.stop()
  //expect(Mistral.prototype.abort).toHaveBeenCalled()
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
