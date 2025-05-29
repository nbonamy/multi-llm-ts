
import { LlmChunkContent, LlmChunkTool } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama, { OllamaStreamingContext } from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadModels, loadOllamaModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'

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
  expect(models!.chat).toStrictEqual([
    { id: 'cogito:latest', name: 'cogito', meta: { model: 'cogito:latest', name: 'cogito' }, capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'gemma3:latest', name: 'gemma3', meta: { model: 'gemma3:latest', name: 'gemma3' }, capabilities: { tools: false, vision: true, reasoning: false } },
    { id: 'model:7b', name: 'model', meta: { model: 'model:7b', name: 'model' }, capabilities: { tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'embed:latest', name: 'embed', meta: { model: 'embed:latest', name: 'embed' }, capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(await loadModels('ollama', config)).toStrictEqual(models)
})

test('Ollama Basic', async () => {
  const ollama = new Ollama(config)
  expect(ollama.getName()).toBe('ollama')
})

test('Ollama buildPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  expect(ollama.buildPayload(ollama.buildModel('llama:latest'), [ message ])).toStrictEqual([ { role: 'user', content: 'text' } ])
  expect(ollama.buildPayload(ollama.buildModel('llava:latest'), [ message ])).toStrictEqual([ { role: 'user', content: 'text', images: [ 'image' ] }])
})

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete(ollama.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' },
    ],
    options: { temperature : 0.8 },
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
    for await (const msg of ollama.nativeChunkToLlmChunk(chunk, context)) {
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
    for await (const msg of ollama.nativeChunkToLlmChunk(chunk, context)) {
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
      { role: 'assistant', content: '', done: false, tool_calls: [ { function: { name: 'plugin2', arguments: [ 'arg' ] } } ] },
      { role: 'tool', content: '"result2"' },
    ],
    //tool_choice: 'auto',
    tools: expect.any(Array),
    options: { top_k: 4 },
    stream: true,
  })
  expect(lastMsg!.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
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

test('Ollama nativeChunkToLlmChunk Text', async () => {
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
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.done = true
  streamChunk.message.content = null
  for await (const llmChunk of ollama.nativeChunkToLlmChunk(streamChunk, context)) {
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
