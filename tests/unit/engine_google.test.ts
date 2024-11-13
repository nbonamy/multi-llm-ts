
import { EngineCreateOpts } from '../../src/types/index.d'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Google from '../../src/providers/google'
import { loadGoogleModels } from '../../src/llm'
import { EnhancedGenerateContentResponse, FunctionCall, FinishReason } from '@google/generative-ai'
import * as _Google from '@google/generative-ai'
import { LlmChunkContent } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@google/generative-ai', async() => {
  const GenerativeModel = vi.fn()
  GenerativeModel.prototype.generateContent = vi.fn(() => { return { response: { text: () => 'response' } } })
  GenerativeModel.prototype.generateContentStream = vi.fn(() => {
    return { stream: {
      async * [Symbol.asyncIterator]() {
        
        // first we yield tool call chunks
        yield { functionCalls: () => [{ name: 'plugin2', args: ['arg'] }] }
        
        // now the text response
        const content = 'response'
        for (let i = 0; i < content.length; i++) {
          yield { functionCalls: (): any[] => [], candidates: [ { finishReason: 'none' }], text: () => content[i] }
        }
        yield { functionCalls: (): any[] => [], candidates: [ { finishReason: 'STOP' }], text: vi.fn(() => null) }
      }
    }}
  })
  const GoogleGenerativeAI = vi.fn()
  GoogleGenerativeAI.prototype.apiKey = '123'
  GoogleGenerativeAI.prototype.getGenerativeModel = vi.fn(() => new GenerativeModel())
  const SchemaType = { STRING: 'string', NUMBER: 'number', OBJECT: 'object'}
  const FunctionCallingMode = { AUTO: 'auto' }
  return { GoogleGenerativeAI, GenerativeModel, default: GoogleGenerativeAI, SchemaType, FunctionCallingMode }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
  vi.clearAllMocks()
})

test('Google Load Models', async () => {
  const models = await loadGoogleModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'models/gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash-latest', name: 'Gemini  1.5 Flash' },
    { id: 'models/gemini-pro', name: 'Gemini 1.0 Pro' },
  ])
})

test('Google Basic', async () => {
  const google = new Google(config)
  expect(google.getName()).toBe('google')
  expect(google.isVisionModel('models/gemini-pro')).toBe(false)
  expect(google.isVisionModel('gemini-1.5-flash-latest')).toBe(true)
  expect(google.isVisionModel('models/gemini-1.5-pro-latest')).toBe(true)
})

test('Google completion', async () => {
  const google = new Google(config)
  const response = await google.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_Google.GoogleGenerativeAI).toHaveBeenCalled()
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalled()
  expect(_Google.GenerativeModel.prototype.generateContent).toHaveBeenCalledWith({ contents: [{
    role: 'user',
    parts: [ { text: 'prompt' } ]
  }]})
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Google nativeChunkToLlmChunk Text', async () => {
  const google = new Google(config)
  const streamChunk: EnhancedGenerateContentResponse = {
    candidates: [ {
      index: 0,
      content: { role: 'model', parts: [ { text: 'response' } ] },
      //finishReason: FinishReason.STOP,
    } ],
    text: vi.fn(() => 'response'),
    functionCalls: vi.fn((): FunctionCall[] => []),
    functionCall: null,
  }
  for await (const llmChunk of google.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.candidates[0].finishReason = 'STOP' as FinishReason
  streamChunk.text = vi.fn(() => null)
  for await (const llmChunk of google.nativeChunkToLlmChunk(streamChunk)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: '', done: true })
  }
})

test('Google stream', async () => {
  const google = new Google(config)
  google.addPlugin(new Plugin1())
  google.addPlugin(new Plugin2())
  google.addPlugin(new Plugin3())
  const stream = await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(_Google.GoogleGenerativeAI).toHaveBeenCalled()
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalled()
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({ contents: [{
    role: 'user',
    parts: [ { text: 'prompt' } ]
  }]})
  let response = ''
  let lastMsg: LlmChunkContent|null = null
  const toolCalls = []
  for await (const chunk of stream) {
    for await (const msg of google.nativeChunkToLlmChunk(chunk)) {
      lastMsg = msg
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await google.stop(stream)
  //expect(response.controller.abort).toHaveBeenCalled()
})

test('Google Text Attachments', async () => {
  const google = new Google(config)
  await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('text1', 'text/plain')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('text2', 'text/plain')),
  ])
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({ contents: [
    { role: 'user', parts: [ { text: 'prompt1\n\ntext1' } ] },
    { role: 'model', parts: [ { text: 'response1' } ] },
    { role: 'user', parts: [ { text: 'prompt2\n\ntext2' } ] },
  ]})
})

test('Google Image Attachments', async () => {
  const google = new Google(config)
  await google.stream('models/gemini-1.5-pro-latest', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('image1', 'image/png')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('image2', 'image/png')),
  ])
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({ contents: [
    { role: 'user', parts: [ { text: 'prompt1' } ] },
    { role: 'model', parts: [ { text: 'response1' } ] },
    { role: 'user', parts: [ { text: 'prompt2' }, { inlineData: { data: 'image2', mimeType: 'image/png' }} ] },
  ]})
})
