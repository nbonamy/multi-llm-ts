
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Google, { GoogleStreamingContext } from '../../src/providers/google'
import { loadGoogleModels, loadModels } from '../../src/llm'
import { GenerateContentResponse, FinishReason } from '@google/genai'
import * as _Google from '@google/genai'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('@google/genai', async () => {
  const GoogleGenAI = vi.fn()
  GoogleGenAI.prototype.models = {
    list: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        const models = [
          { name: 'models/embed-content', displayName: 'Non Generate Content', description: '', supportedActions: ['embedContent'] },
          { name: 'models/deprecated', displayName: 'Deprecated', description: 'was deprecated in', supportedActions: ['generateContent'] },
          { name: 'models/discontinued', displayName: 'Discontinued', description: 'was discontinued in', supportedActions: ['generateContent'] },
          { name: 'models/tuning', displayName: 'Tuning', description: 'can be used to tune', supportedActions: ['generateContent'] },
          { name: 'models/gemini-001', displayName: 'Gemini 001', description: '', supportedActions: ['generateContent'] },
          { name: 'models/gemini-1.5', displayName: 'Gemini 1.5', description: '', supportedActions: ['generateContent'] },
          { name: 'models/gemini-1.5-latest', displayName: 'Gemini 1.5', description: '', supportedActions: ['generateContent'] },
          { name: 'models/gemini-2.0', displayName: 'Gemini 2.0', supportedActions: ['generateContent', 'bidiGenerateContent'] },
          { name: 'models/gemini-2.5-tts', displayName: 'Gemini 2.5 TTS', supportedActions: [ 'generateContent'] },
          { name: 'models/gemma-model', displayName: 'Gemma Model', description: '', supportedActions: ['generateContent'] },
          { name: 'models/image-model', displayName: 'Image Model', description: '', supportedActions: ['bidiGenerateContent'] },
          { name: 'models/native-audio-dialog-model', displayName: 'Dialog Model', description: '', supportedActions: ['bidiGenerateContent'] },
        ]
        for (const model of models) {
          yield model
        }
      }
    })),
    generateContent: vi.fn(() => { return { text: 'response', functionCalls: [] } }),
    generateContentStream: vi.fn(() => {
      return {
        async *[Symbol.asyncIterator]() {

          // first we yield tool call chunks
          yield { candidates: [{ content: { parts: [{
            functionCall: { name: 'plugin2', args: ['arg'] }
          }] } }], functionCalls: [{ name: 'plugin2', args: ['arg'] }] }

          // now the text response
          const content = 'response'
          for (let i = 0; i < content.length; i++) {
            yield { candidates: [{ finishReason: 'none' }], text: content[i], functionCalls: [] }
          }
          yield { candidates: [{ finishReason: 'STOP' }], text: null, functionCalls: [] }
        }
      }
    })
  }
  const Type = { STRING: 'string', NUMBER: 'number', OBJECT: 'object' }
  const FunctionCallingConfigMode = { AUTO: 'auto' }
  return { GoogleGenAI, Type, FunctionCallingConfigMode }
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
  expect(models!.chat).toStrictEqual([
    { id: 'gemini-1.5-latest', name: 'Gemini 1.5', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'gemini-1.5', name: 'Gemini 1.5', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'gemma-model', name: 'Gemma Model', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([
    { id: 'image-model', name: 'Image Model', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
    { id: 'gemini-2.0', name: 'Gemini 2.0', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.embedding).toStrictEqual([
    { id: 'embed-content', name: 'Non Generate Content', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.realtime).toStrictEqual([
    { id: 'native-audio-dialog-model', name: 'Dialog Model', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(models!.tts).toStrictEqual([
    { id: 'gemini-2.5-tts', name: 'Gemini 2.5 TTS', meta: expect.any(Object), capabilities: { tools: false, vision: false, reasoning: false } },
  ])
  expect(await loadModels('google', config)).toStrictEqual(models)
})

test('Google Basic', async () => {
  const google = new Google(config)
  expect(google.getName()).toBe('google')
})

test('Google completion', async () => {
  const google = new Google(config)
  const response = await google.complete(google.buildModel('gemma'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 0.8 })
  expect(_Google.GoogleGenAI).toHaveBeenCalled()
  expect(_Google.GoogleGenAI.prototype.models.generateContent).toHaveBeenCalledWith({
    model: 'gemma',
    contents: [
      { role: 'user', parts: [{ text: 'instruction' }] },
      { role: 'user', parts: [{ text: 'prompt' }] }
    ], config: {
      // systemInstruction: 'instruction',
      temperature: 0.8
    }
  })
  expect(response).toStrictEqual({
    type: 'text',
    content: 'response',
    toolCalls: [],
  })
})

test('Google nativeChunkToLlmChunk Text', async () => {
  const google = new Google(config)
  const streamChunk: GenerateContentResponse = {
    candidates: [{
      index: 0,
      content: { role: 'model', parts: [{ text: 'response' }] },
      //finishReason: FinishReason.STOP,
    }],
    text: 'response',
    functionCalls: [],
  } as unknown as GenerateContentResponse
  const context: GoogleStreamingContext = {
    model: google.buildModel('model'),
    content: [],
    opts: {},
    toolCalls: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  }
  for await (const llmChunk of google.nativeChunkToLlmChunk(streamChunk, context)) {
    expect(llmChunk).toStrictEqual({ type: 'content', text: 'response', done: false })
  }
  streamChunk.candidates![0].finishReason = 'STOP' as FinishReason
  // @ts-expect-error mock
  streamChunk.text = ''
  for await (const llmChunk of google.nativeChunkToLlmChunk(streamChunk, context)) {
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
  const { stream, context } = await google.stream(google.buildModel('gemini-pro'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 1.0, top_k: 4 })
  expect(_Google.GoogleGenAI).toHaveBeenCalled()
  expect(_Google.GoogleGenAI.prototype.models.generateContentStream).toHaveBeenNthCalledWith(1, {
    model: 'gemini-pro',
    contents: [{
      role: 'user',
      parts: [{ text: 'prompt' }]
    }], config: {
      systemInstruction: 'instruction',
      topK: 4,
      temperature: 1.0,
      toolConfig: { functionCallingConfig: { mode: 'auto' } },
      tools: tools,
    }
  })
  let response = ''
  let lastMsg: LlmChunkContent | null = null
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of google.nativeChunkToLlmChunk(chunk, context)) {
      lastMsg = msg as LlmChunkContent
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(_Google.GoogleGenAI.prototype.models.generateContentStream).toHaveBeenNthCalledWith(2, {
    model: 'gemini-pro',
    contents: [
      { role: 'user', parts: [{ text: 'prompt' }] },
      { role: 'assistant', parts: [{ functionCall: { name: 'plugin2', args: ['arg'] } }] },
      { role: 'tool', parts: [{ functionResponse: { id: 'plugin2', name: 'plugin2', response: 'result2' } }] },
    ], config: {
      systemInstruction: 'instruction',
      topK: 4,
      temperature: 1.0,
      toolConfig: { functionCallingConfig: { mode: 'auto' } },
      tools: tools,
    }
  })
  expect(lastMsg?.done).toBe(true)
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'gemini-pro' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 'plugin2', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 'plugin2', name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 'plugin2', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await google.stop(stream)
  //expect(response.controller.abort).toHaveBeenCalled()
})

test('Google stream tools disabled', async () => {
  const google = new Google(config);
  google.addPlugin(new Plugin1())
  google.addPlugin(new Plugin2())
  google.addPlugin(new Plugin3())
  await google.stream(google.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { temperature: 1.0, top_k: 4, tools: false })
  expect(Plugin2.prototype.execute).not.toHaveBeenCalled()
})

test('Google stream without tools', async () => {
  const google = new Google(config)
  await google.stream(google.buildModel('gemini-pro'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { top_p: 4 })
  expect(_Google.GoogleGenAI).toHaveBeenCalled()
  expect(_Google.GoogleGenAI.prototype.models.generateContentStream).toHaveBeenCalledWith({
    model: 'gemini-pro',
    contents: [{
      role: 'user',
      parts: [{ text: 'prompt' }]
    }], config: {
      systemInstruction: 'instruction',
      topP: 4
    }
  })
})

test('Google Text Attachments', async () => {
  const google = new Google(config)
  await google.stream(google.buildModel('gemini-pro'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('text1', 'text/plain')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('text2', 'text/plain')),
  ])
  expect(_Google.GoogleGenAI.prototype.models.generateContentStream).toHaveBeenCalledWith({
    model: 'gemini-pro',
    config: { systemInstruction: 'instruction' },
    contents: [
      { role: 'user', parts: [{ text: 'prompt1' }, { text: 'text1' }] },
      { role: 'model', parts: [{ text: 'response1' }] },
      { role: 'user', parts: [{ text: 'prompt2', }, { text: 'text2' }] },
    ]
  })
})

test('Google Image Attachments', async () => {
  const google = new Google(config)
  await google.stream(google.buildModel('gemini-1.5-pro-latest'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt1', new Attachment('image1', 'image/png')),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2', new Attachment('image2', 'image/png')),
  ])
  expect(_Google.GoogleGenAI.prototype.models.generateContentStream).toHaveBeenCalledWith({
    model: 'gemini-1.5-pro-latest',
    config: { systemInstruction: 'instruction' },
    contents: [
      // { role: 'user', parts: [{ text: 'instruction' }] },
      { role: 'user', parts: [{ text: 'prompt1' }, { inlineData: { data: 'image1', mimeType: 'image/png' } }] },
      { role: 'model', parts: [{ text: 'response1' }] },
      { role: 'user', parts: [{ text: 'prompt2' }, { inlineData: { data: 'image2', mimeType: 'image/png' } }] },
    ]
  })
})
