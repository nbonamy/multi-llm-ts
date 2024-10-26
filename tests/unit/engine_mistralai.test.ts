
import { LLmCompletionPayload } from '../../src/types/llm.d'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import MistralAI from '../../src/providers/mistralai'
import { Mistral } from '@mistralai/mistralai'
import { CompletionEvent } from '@mistralai/mistralai/models/components'
import { loadMistralAIModels } from '../../src/llm'
import { EngineConfig, Model } from '../../src/types/index.d'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@mistralai/mistralai', async() => {
  const Mistral = vi.fn()
  Mistral.prototype.options$ = {
    apiKey: '123'
  }
  Mistral.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'model2', name: 'model2' },
        { id: 'model1', name: 'model1' },
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
          yield { data: { choices: [{ delta: { toolCalls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] } }
          yield { data: { choices: [{ delta: { toolCalls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] } }
          yield { data: { choices: [{ finishReason: 'tool_calls' } ] } }
          
          // now the text response
          const content = 'response'
          for (let i = 0; i < content.length; i++) {
            yield { data: { choices: [{ delta: { content: content[i], }, finish_reason: 'none' }] } }
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

let config: EngineConfig = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('MistralAI Load Models', async () => {
  expect(await loadMistralAIModels(config)).toBe(true)
  const models = config.models.chat
  expect(models.map((m: Model) => { return { id: m.id, name: m.name }})).toStrictEqual([
    { id: 'model1', name: 'model1' },
    { id: 'model2', name: 'model2' },
  ])
  expect(config.model.chat).toStrictEqual(models[0].id)
})

test('MistralAI Basic', async () => {
  const mistralai = new MistralAI(config)
  expect(mistralai.getName()).toBe('mistralai')
  expect(mistralai.isVisionModel('mistral-medium')).toBe(false)
  expect(mistralai.isVisionModel('mistral-large')).toBe(false)
})

test('MistralAI  completion', async () => {
  const mistralai = new MistralAI(config)
  const response = await mistralai.complete([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(Mistral.prototype.chat.complete).toHaveBeenCalled()
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
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
  for await (const llmChunk of mistralai.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.data.choices[0].delta.content = null
  streamChunk.data.choices[0].finishReason = 'stop'
  for await (const llmChunk of mistralai.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('MistralAI  stream', async () => {
  const mistralai = new MistralAI(config)
  mistralai.addPlugin(new Plugin1(config))
  mistralai.addPlugin(new Plugin2(config))
  mistralai.addPlugin(new Plugin3(config))
  const stream = await mistralai.stream([
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], null)
  expect(Mistral.prototype.chat.stream).toHaveBeenCalled()
  expect(stream.controller).toBeDefined()
  let response = ''
  let lastMsg = null
  const toolCalls = []
  for await (const chunk of stream) {
    for await (const msg of mistralai.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', text: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', text: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', done: true })
  await mistralai.stop()
  //expect(Mistral.prototype.abort).toHaveBeenCalled()
})

test('MistralAI  image', async () => {
  const mistralai = new MistralAI(config)
  const response = await mistralai.image('image', null)
  expect(response).toBeNull()
})

test('MistralAI addImageToPayload', async () => {
  const mistralai = new MistralAI(config)
  const message = new Message('user', 'text')
  message.attachFile(new Attachment('', 'image/png', 'image', true ))
  const payload: LLmCompletionPayload = { role: 'user', content: message }
  mistralai.addImageToPayload(message, payload)
  expect(payload.images).toStrictEqual([ 'image' ])
})
