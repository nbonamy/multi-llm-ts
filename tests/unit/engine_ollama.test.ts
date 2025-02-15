
import { LlmChunkContent, LlmChunkTool } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadModels, loadOllamaModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('ollama/dist/browser.cjs', async() => {
  const Ollama = vi.fn()
  Ollama.prototype.list = vi.fn(() => {
    return { models: [
      { model: 'model2', name: 'model2' },
      { model: 'model1', name: 'model1' },
    ] }
  })
  Ollama.prototype.pull = vi.fn()
  Ollama.prototype.delete = vi.fn()
  Ollama.prototype.show = vi.fn(() => {
    return {
      details: { family: 'llm' },
      model_info: {}
    }
  })
  Ollama.prototype.chat = vi.fn((opts) => {
    if (opts.stream) {
      return {
        async * [Symbol.asyncIterator]() {
              
          // first we yield tool call chunks
          if (opts.model.includes('tool')) {
            yield { message: { role: 'assistant', content: '', tool_calls: [{
                function: { name: 'plugin2', arguments: ['arg'] },
              }], done: false }
            }
          }
          
          // yield some reasoning
          const reasoning = 'reasoning'
          yield { message: { role: 'assistant', content: '<think>' }, done: false }
          for (let i = 0; i < reasoning.length; i++) {
            yield { message: { role: 'assistant', content: reasoning[i] }, done: false }
          }
          yield { message: { role: 'assistant', content: '</think>' }, done: false }

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
  expect(models.chat).toStrictEqual([
    { id: 'model1', name: 'model1', meta: { model: 'model1', name: 'model1' }, },
    { id: 'model2', name: 'model2', meta: { model: 'model2', name: 'model2' }, },
  ])
  expect(await loadModels('ollama', config)).toStrictEqual(models)
})

test('Ollama Basic', async () => {
  const ollama = new Ollama(config)
  expect(ollama.getName()).toBe('ollama')
})

test('Ollama Vision Models', async () => {
  const ollama = new Ollama(config)
  expect(ollama.isVisionModel('llava:latest')).toBe(true)
  expect(ollama.isVisionModel('llama2:latest')).toBe(false)
})

test('Ollama buildPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(ollama.buildPayload('llama', [ message ])).toStrictEqual([ { role: 'user', content: 'text' } ])
  expect(ollama.buildPayload('llava', [ message ])).toStrictEqual([ { role: 'user', content: 'text', images: [ 'image' ]} ])
})

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    options: { temperature : 0.8 },
    stream: false,
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Ollama stream without tools', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  const stream = await ollama.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
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
    for await (const msg of ollama.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'reasoning') reasoning += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg!.done).toBe(true)
  expect(response).toBe('response')
  expect(reasoning).toBe('reasoning')
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama stream with tools', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  const stream = await ollama.stream('llama3-groq-tool-use', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_k: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    tool_choice: 'auto',
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
    for await (const msg of ollama.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg!.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama stream without tools and options', async () => {
  const ollama = new Ollama(config)
  const stream = await ollama.stream('llama3-groq-tool-use', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { contextWindowSize: 4096, top_p: 4 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'llama3-groq-tool-use',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    stream: true,
    options: {
      num_ctx: 4096,
      top_p: 4,
    }
  })
  expect(stream).toBeDefined()
})

test('Ollama nativeChunkToLlmChunk Text', async () => {
  const ollama = new Ollama(config)
  const streamChunk: any = {
    message: { content: 'response'},
    done: false
  }
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.done = true
  streamChunk.message.content = null
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk)) {
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
