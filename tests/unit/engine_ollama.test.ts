
import { LLmCompletionPayload } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Ollama from '../../src/providers/ollama'
import * as _ollama from 'ollama/dist/browser.cjs'
import { loadOllamaModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index.d'
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
            yield { message: { role: 'assistant', content: '', tool_calls: [{
              function: { name: 'plugin2', arguments: ['arg'] },
            }], done: false }
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

test('Ollama completion', async () => {
  const ollama = new Ollama(config)
  const response = await ollama.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Ollama stream', async () => {
  const ollama = new Ollama(config)
  ollama.addPlugin(new Plugin1())
  ollama.addPlugin(new Plugin2())
  ollama.addPlugin(new Plugin3())
  const stream = await ollama.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_ollama.Ollama.prototype.chat).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    stream: true,
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg = null
  const toolCalls = []
  console.log(stream)
  for await (const chunk of stream) {
    for await (const msg of ollama.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text || ''
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await ollama.stop()
  expect(_ollama.Ollama.prototype.abort).toHaveBeenCalled()
})

test('Ollama addAttachmentToPayload', async () => {
  const ollama = new Ollama(config)
  const message = new Message('user', 'text')
  message.attach(new Attachment('image', 'image/png'))
  const payload: LLmCompletionPayload = { role: 'user', content: message }
  ollama.addAttachmentToPayload(message, payload)
  expect(payload.images).toStrictEqual([ 'image' ])
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

test('Build payload with image attachment', async () => {
  const ollama = new Ollama(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(ollama.buildPayload('llama', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
  ])
  expect(ollama.buildPayload('llama3.2-vision:11b', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1', images: [ 'image' ] },
  ])
})
