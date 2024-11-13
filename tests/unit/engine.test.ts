
import { LlmChunk } from '../../src/types/llm.d'
import { vi, expect, test } from 'vitest'
import { igniteEngine, isVisionModel, hasVisionModels } from '../../src/llm'
import { Plugin2 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import OpenAI from '../../src/providers/openai'
import Ollama from '../../src/providers/ollama'
import MistralAI from '../../src/providers/mistralai'
import Anthropic from '../../src/providers/anthropic'
import Google from '../../src/providers/google'
import XAI from '../../src/providers/xai'
import Groq from '../../src/providers/groq'
import Cerebras from '../../src/providers/cerebras'
import * as _openai from 'openai'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

const config = { apiKey: '123' }

vi.mock('openai', async() => {
  let streamIteration = 0
  const OpenAI = vi.fn()
  OpenAI.prototype.apiKey = '123'
  OpenAI.prototype.models = {
    list: vi.fn(() => {
      return { data: [
        { id: 'gpt-model2', name: 'model2' },
        { id: 'gpt-model1', name: 'model1' },
        { id: 'dall-e-model2', name: 'model2' },
        { id: 'dall-e-model1', name: 'model1' },
      ] }
    })
  }
  OpenAI.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              // first we yield tool call chunks
              if (opts.model != 'model-no-tool' && opts.model != 'model-vision' && streamIteration == 0) {
                yield { choices: [{ delta: { tool_calls: [ { id: 1, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
                yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'none' } ] }
                yield { choices: [{ finish_reason: 'tool_calls' } ] }
                streamIteration = 1
              } else {
                // now the text response
                const content = 'response'
                for (let i = 0; i < content.length; i++) {
                  yield { choices: [{ delta: { content: content[i] }, finish_reason: 'none' }] }
                }
                yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
              }
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
  return { default: OpenAI }
})

test('Default Configuration', () => {
  expect(OpenAI.isConfigured({})).toBe(false)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured({})).toBe(false)
  expect(Google.isConfigured({})).toBe(false)
  expect(MistralAI.isConfigured({})).toBe(false)  
  expect(XAI.isConfigured({})).toBe(false)
  expect(Groq.isConfigured({})).toBe(false)
  expect(Cerebras.isConfigured({})).toBe(false)
})

test('Valid Configuration', () => {
  expect(OpenAI.isConfigured(config)).toBe(true)
  expect(Ollama.isConfigured({})).toBe(true)
  expect(Anthropic.isConfigured(config)).toBe(true)
  expect(Google.isConfigured(config)).toBe(true)
  expect(MistralAI.isConfigured(config)).toBe(true)
  expect(XAI.isConfigured(config)).toBe(true)
  expect(Groq.isConfigured(config)).toBe(true)
  expect(Cerebras.isConfigured(config)).toBe(true)
})

test('Ignite Engine', async () => {
  expect(await igniteEngine('openai', config)).toBeInstanceOf(OpenAI)
  expect(await igniteEngine('ollama', config)).toBeInstanceOf(Ollama)
  expect(await igniteEngine('mistralai', config)).toBeInstanceOf(MistralAI)
  expect(await igniteEngine('anthropic', config)).toBeInstanceOf(Anthropic)
  expect(await igniteEngine('google', config)).toBeInstanceOf(Google)
  expect(await igniteEngine('xai', config)).toBeInstanceOf(XAI)
  expect(await igniteEngine('groq', config)).toBeInstanceOf(Groq)
  expect(await igniteEngine('cerebras', config)).toBeInstanceOf(Cerebras)
  expect(async() => await igniteEngine('aws', config)).rejects.toThrowError(/Unknown engine/)
})

test('Has Vision Models', async () => {
  expect(hasVisionModels('openai', config)).toBe(true)
  expect(hasVisionModels('ollama', config)).toBe(true)
  expect(hasVisionModels('mistralai', config)).toBe(false)
  expect(hasVisionModels('anthropic', config)).toBe(true)
  expect(hasVisionModels('google', config)).toBe(true)
  expect(hasVisionModels('xai', config)).toBe(false)
  expect(hasVisionModels('groq', config)).toBe(false)
  expect(hasVisionModels('cerebras', config)).toBe(false)
})

test('Is Vision Model', async () => {
  expect(isVisionModel('openai', 'gpt-3.5', config)).toBe(false)
  expect(isVisionModel('openai', 'gpt-4-turbo', config)).toBe(true)
  expect(isVisionModel('openai', 'gpt-vision', config)).toBe(true)
  expect(isVisionModel('anthropic', 'claude-sonnet-35-latest', config)).toBe(true)
})

test('Find Models', async () => {
  const models = [
    { id: 'gpt-model1', name: 'gpt-model1', meta: {} },
    { id: 'gpt-model2', name: 'gpt-model2', meta: {} },
  ]
  const openai = new OpenAI(config)
  expect(openai.findModel(models, ['gpt-model'])).toBeNull()
  expect(openai.findModel(models, ['gpt-vision*'])).toBeNull()
  expect(openai.findModel(models, ['*']).id).toBe('gpt-model1')
  expect(openai.findModel(models, ['gpt-model2']).id).toBe('gpt-model2')
  expect(openai.findModel(models, ['gpt-model*']).id).toBe('gpt-model1')
  expect(openai.findModel(models, ['gpt-vision', '*gpt*2*']).id).toBe('gpt-model2')
})

test('Build payload no attachment', async () => {
  const openai = new OpenAI(config)
  expect(openai.buildPayload('gpt-model1', [])).toStrictEqual([]) 
  expect(openai.buildPayload('gpt-model1', 'content')).toStrictEqual([{ role: 'user', content: 'content' }])
  expect(openai.buildPayload('got-model1', [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2'),
    new Message('assistant', 'response2'),
  ])).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
    { role: 'assistant', content: 'response1' },
    { role: 'user', content: 'prompt2' },
    { role: 'assistant', content: 'response2' }
  ])
})

test('Build payload with text attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('text', 'text/plain'))
  expect(openai.buildPayload('gpt-model1', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1\n\ntext' },
  ])
})

test('Build payload with image attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload('gpt-model1', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: 'prompt1' },
  ])
  expect(openai.buildPayload('gpt-4-vision', messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Complete content', async () => {
  const openai = new OpenAI({ ...config, ...{ model: { chat: 'gpt-model1' }}})
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  const response = await openai.complete('model', messages)
  expect(response).toStrictEqual({ type: 'text', 'content': 'response' })
})

test('Generate content', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  const stream = openai.generate('model', messages)
  expect(stream).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    if (chunk.type == 'content') response += chunk.text
    else if (chunk.type == 'tool') toolCalls.push(chunk)
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', name: 'plugin2', status: 'run2', done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
})

test('Does not switch vision by default', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate('model-no-tool', messages, { models: [ { id: 'model-vision', name: 'model-vision' }] })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-no-tool', stream: true, stream_options: { include_usage: false },
    messages: [ { role: 'system', content: 'instructions' }, { role: 'user', content: 'prompt1' } ]
  })
})

test('Switches to vision when asked', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate('model-no-tool', messages, { autoSwitchVision: true, models: [ { id: 'model-vision', name: 'model-vision' }] })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-vision', stream: true, stream_options: { include_usage: false },
    messages: [ { role: 'system', content: 'instructions' }, { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]}]
  })
})
