
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Google from '../../src/providers/google'
import { loadGoogleModels, loadModels } from '../../src/llm'
import { EnhancedGenerateContentResponse, FunctionCall, FinishReason } from '@google/generative-ai'
import * as _Google from '@google/generative-ai'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

global.fetch = vi.fn((): Promise<Response> => Promise.resolve(new Response(JSON.stringify({
  models: [
    { name: 'models/embed-content', displayName: 'Non Generate Content', description: '', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/deprecated', displayName: 'Deprecated', description: 'was deprecated in', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/discontinued', displayName: 'Discontinued', description: 'was discontinued in', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/tuning', displayName: 'Tuning', description: 'can be used to tune', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-001', displayName: 'Gemini 001', description: '', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-1.5', displayName: 'Gemini 1.5', description: '', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-1.5-latest', displayName: 'Gemini 1.5', description: '', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.0', displayName: 'Gemini 2.0', supportedGenerationMethods: ['generateContent', 'bidiGenerateContent'] },
    { name: 'models/image-model', displayName: 'New Model', description: '', supportedGenerationMethods: ['bidiGenerateContent'] },
  ]
}))))

vi.mock('@google/generative-ai', async () => {
  const GenerativeModel = vi.fn()
  GenerativeModel.prototype.generateContent = vi.fn(() => { return { response: { text: () => 'response' } } })
  GenerativeModel.prototype.generateContentStream = vi.fn(() => {
    return {
      stream: {
        async *[Symbol.asyncIterator]() {

          // first we yield tool call chunks
          yield { candidates: [{ content: { parts: [] } }], functionCalls: () => [{ name: 'plugin2', args: ['arg'] }] }

          // now the text response
          const content = 'response'
          for (let i = 0; i < content.length; i++) {
            yield { candidates: [{ finishReason: 'none' }], text: () => content[i], functionCalls: (): any[] => [] }
          }
          yield { candidates: [{ finishReason: 'STOP' }], text: vi.fn(() => null), functionCalls: (): any[] => [] }
        }
      }
    }
  })
  const GoogleGenerativeAI = vi.fn()
  GoogleGenerativeAI.prototype.apiKey = '123'
  GoogleGenerativeAI.prototype.getGenerativeModel = vi.fn(() => new GenerativeModel())
  const SchemaType = { STRING: 'string', NUMBER: 'number', OBJECT: 'object' }
  const FunctionCallingMode = { AUTO: 'auto' }
  return { GoogleGenerativeAI, GenerativeModel, default: GoogleGenerativeAI, SchemaType, FunctionCallingMode }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Google Load Models', async () => {
  const models = await loadGoogleModels(config)
  expect(models.chat).toStrictEqual([
    { id: 'gemini-2.0', name: 'Gemini 2.0', meta: expect.any(Object) },
    { id: 'gemini-1.5-latest', name: 'Gemini 1.5', meta: expect.any(Object) },
  ])
  expect(models.image).toStrictEqual([
    { id: 'image-model', name: 'New Model', meta: expect.any(Object) },
    { id: 'gemini-2.0', name: 'Gemini 2.0', meta: expect.any(Object) },
  ])
  expect(models.embedding).toStrictEqual([
    { id: 'embed-content', name: 'Non Generate Content', meta: expect.any(Object) },
  ])
  expect(await loadModels('google', config)).toStrictEqual(models)
})

test('Google Basic', async () => {
  const google = new Google(config)
  expect(google.getName()).toBe('google')
})

test('Google Vision Model', async () => {
  const google = new Google(config)
  expect(google.isVisionModel('gemini-pro')).toBe(false)
  expect(google.isVisionModel('gemini-1.5-flash-latest')).toBe(true)
  expect(google.isVisionModel('gemini-1.5-pro-latest')).toBe(true)
  expect(google.isVisionModel('gemini-2.0-flash-exp')).toBe(true)
  expect(google.isVisionModel('gemini-exp-1206')).toBe(true)
  expect(google.isVisionModel('gemini-2.0-flash-thinking-exp-1219')).toBe(true)
  expect(google.isVisionModel('gemini-2.0-flash-thinking-exp-01-21')).toBe(true)
})

test('Google Tools Support', async () => {
  const google = new Google(config)
  expect(google.supportsTools('gemini-pro')).toBe(true)
  expect(google.supportsTools('gemini-1.5-flash-latest')).toBe(true)
  expect(google.supportsTools('gemini-1.5-pro-latest')).toBe(true)
  expect(google.supportsTools('gemini-2.0-flash-exp')).toBe(true)
  expect(google.supportsTools('gemini-exp-1206')).toBe(true)
  expect(google.supportsTools('gemini-2.0-flash-thinking-exp-1219')).toBe(false)
  expect(google.supportsTools('gemini-2.0-flash-thinking-exp-01-21')).toBe(false)
})

test('Google completion', async () => {
  const google = new Google(config)
  const response = await google.complete('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Google.GoogleGenerativeAI).toHaveBeenCalled()
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalled()
  expect(_Google.GenerativeModel.prototype.generateContent).toHaveBeenCalledWith({
    contents: [{
      role: 'user',
      parts: [{ text: 'prompt' }]
    }], generationConfig: {
      temperature: 0.8
    }
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response'
  })
})

test('Google nativeChunkToLlmChunk Text', async () => {
  const google = new Google(config)
  const streamChunk: EnhancedGenerateContentResponse = {
    candidates: [{
      index: 0,
      content: { role: 'model', parts: [{ text: 'response' }] },
      //finishReason: FinishReason.STOP,
    }],
    text: vi.fn(() => 'response'),
    functionCalls: vi.fn((): FunctionCall[] => []),
    functionCall: () => undefined,
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

  const tools = [
    {
      functionDeclarations: [
        {
          description: 'Plugin 1',
          name: 'plugin1',
        },
        {
          description: 'Plugin 2',
          name: 'plugin2',
          parameters: {
            properties: {
              param1: {
                type: 'string',
                description: 'Parameter 1',
              },
              param2: {
                type: 'number',
                description: 'Parameter 2',
              },
              param3: {
                type: undefined,
                description: 'Parameter 3',
                items: {
                  properties: undefined,
                  type: 'string',
                },
              },
              param4: {
                type: undefined,
                description: 'Parameter 4',
                items: {
                  properties: undefined,
                  type: 'string',
                },
              },
              param5: {
                type: undefined,
                description: 'Parameter 5',
                items: {
                  properties: {
                    key: {
                      description: 'Key',
                      type: 'string',
                    },
                    value: {
                      description: 'Value',
                      type: 'number',
                    },
                  },
                  type: 'object',
                },
              },
              param6: {
                type: 'string',
                description: 'Parameter 6',
              },
              param7: {
                type: undefined,
                description: 'Parameter 7',
                items: {
                  properties: undefined,
                  type: 'string',
                },
              },
              param8: {
                type: undefined,
                description: 'Parameter 8',
                items: {
                  properties: {
                    key: {
                      description: 'Key',
                      type: 'string',
                    },
                  },
                  type: 'object',
                },
              },
            },
            required: ['param1', 'param3'],
            type: 'object',
          },
        },
      ],
    },
  ]

  const google = new Google(config);
  google.addPlugin(new Plugin1())
  google.addPlugin(new Plugin2())
  google.addPlugin(new Plugin3())
  const stream = await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 1.0, top_k: 4 })
  expect(_Google.GoogleGenerativeAI).toHaveBeenCalled()
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalledWith({
    model: 'model',
    systemInstruction: 'instruction',
    toolConfig: { functionCallingConfig: { mode: 'auto' } },
    tools: tools,
  }, { 'apiVersion': 'v1beta', })
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({
    contents: [{
      role: 'user',
      parts: [{ text: 'prompt' }]
    }], generationConfig: {
      topK: 4,
      temperature: 1.0
    }
  })
  let response = ''
  let lastMsg: LlmChunkContent | null = null
  const toolCalls: LlmChunk[] = []
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

test('Google stream tools disabled', async () => {
  const google = new Google(config);
  google.addPlugin(new Plugin1())
  google.addPlugin(new Plugin2())
  google.addPlugin(new Plugin3())
  await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 1.0, top_k: 4, tools: false })
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalledWith({
    model: 'model',
    systemInstruction: 'instruction',
  }, { 'apiVersion': 'v1beta', })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Google stream without tools', async () => {
  const google = new Google(config)
  await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Google.GoogleGenerativeAI).toHaveBeenCalled()
  expect(_Google.GoogleGenerativeAI.prototype.getGenerativeModel).toHaveBeenCalledWith({
    model: 'model',
    systemInstruction: 'instruction',
  }, { 'apiVersion': 'v1beta', })
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({
    contents: [{
      role: 'user',
      parts: [{ text: 'prompt' }]
    }], generationConfig: {
      topP: 4
    }
  })
})

test('Google Text Attachments', async () => {
  const google = new Google(config)
  await google.stream('model', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('text1', 'text/plain')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('text2', 'text/plain')),
  ])
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({
    contents: [
      { role: 'user', parts: [{ text: 'prompt1\n\ntext1' }] },
      { role: 'model', parts: [{ text: 'response1' }] },
      { role: 'user', parts: [{ text: 'prompt2\n\ntext2' }] },
    ]
  })
})

test('Google Image Attachments', async () => {
  const google = new Google(config)
  await google.stream('gemini-1.5-pro-latest', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('image1', 'image/png')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('image2', 'image/png')),
  ])
  expect(_Google.GenerativeModel.prototype.generateContentStream).toHaveBeenCalledWith({
    contents: [
      { role: 'user', parts: [{ text: 'prompt1' }] },
      { role: 'model', parts: [{ text: 'response1' }] },
      { role: 'user', parts: [{ text: 'prompt2' }, { inlineData: { data: 'image2', mimeType: 'image/png' } }] },
    ]
  })
})
