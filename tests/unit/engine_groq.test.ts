
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Groq from '../../src/providers/groq'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { loadGroqModels, loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import _Groq from 'groq-sdk'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('groq-sdk', async() => {
  const Groq = vi.fn()
  Groq.prototype.apiKey = '123'
  Groq.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model1-9b', active: true, created: 1 },
        { id: 'model2-70b-preview', active: true, created: 2 },
        { id: 'model3', active: false, created: 3 },
        { id: 'whisper', active: true, created: 4 },
      ]}
    })
  }
  Groq.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              
              // first we yield tool call chunks
              if (!opts.model.startsWith('o1-')) {
                yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
              }
              
              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i] }, finish_reason: 'none' }] }
              }
              yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
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
  return { default : Groq }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Groq Load Models', async () => {
  const models = await loadGroqModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'model2-70b-preview', name: 'Model2 70b Preview', meta: expect.any(Object) },
    { id: 'model1-9b', name: 'Model1 9b', meta: expect.any(Object) },
  ])
  expect(await loadModels('groq', config)).toStrictEqual(models)
})

test('Groq Basic', async () => {
  const groq = new Groq(config)
  expect(groq.getName()).toBe('groq')
})

test('Groq Vision Models', async () => {
  const groq = new Groq(config)
  const models = await groq.getModels()
  const vision = [ 'llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview' ]
  for (const model of models) {
    expect(groq.isVisionModel(model.id)).toBe(vision.includes(model.id))
  }
})

test('Groq completion', async () => {
  const groq = new Groq(config)
  const response = await groq.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    temperature : 0.8
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Groq stream', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  groq.addPlugin(new Plugin2())
  groq.addPlugin(new Plugin3())
  const { stream, context } = await groq.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, top_p: 4 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(1, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg:LlmChunkContent|null  = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of groq.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Groq.prototype.chat.completions.create).toHaveBeenNthCalledWith(2, {
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
      { role: 'assistant', content: '', tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "arg" ]' } } ] },
      { role: 'tool', content: '"result2"', name: 'plugin2', tool_call_id: 1 }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    top_p: 4,
    stream: true,
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await groq.stop(stream)
  expect(stream.controller.abort).toHaveBeenCalled()
})

test('Groq stream tools disabled', async () => {
  const groq = new Groq(config)
  groq.addPlugin(new Plugin1())
  groq.addPlugin(new Plugin2())
  groq.addPlugin(new Plugin3())
  await groq.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4, top_p: 4, tools: false })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    top_p: 4,
    stream: true,
  })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Groq stream without tools', async () => {
  const groq = new Groq(config)
  const { stream } = await groq.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Groq.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    top_p: 4,
    stream: true,
  })
  expect(stream).toBeDefined()
})

test('Groq nativeChunkToLlmChunk Text', async () => {
  const groq = new Groq(config)
  const streamChunk: ChatCompletionChunk = {
    id: '123', model: 'model1', created: 1, object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: 'response' }, finish_reason: null }],
  }
  const context = {
    model: 'mode1',
    thread: [],
    opts: {},
    toolCalls: []
  }
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.choices[0].finish_reason = 'stop'
  streamChunk.choices[0].delta.content = null
  for await (const llmChunk of groq.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})
