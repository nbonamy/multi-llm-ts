
import { LlmChunk } from '../../src/types/llm'
import { vi, expect, test } from 'vitest'
import { Plugin1, Plugin2 } from '../mocks/plugins'
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
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
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

test('Build payload no attachment', async () => {
  const openai = new OpenAI(config)
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), [])).toStrictEqual([]) 
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), 'content')).toStrictEqual([{ role: 'user', content: [{ type: 'text', text: 'content' }] }])
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
    new Message('assistant', 'response1'),
    new Message('user', 'prompt2'),
    new Message('assistant', 'response2'),
  ])).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [{ type: 'text', text: 'prompt1' }] },
    { role: 'assistant', content: 'response1' },
    { role: 'user', content: [{ type: 'text', text: 'prompt2' }] },
    { role: 'assistant', content: 'response2' }
  ])
})

test('Build payload with text attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { type: 'text', text: 'attachment' },
    ]}
  ])
})

test('Build payload with image attachment', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-model1'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [{ type: 'text', text: 'prompt1' }] }
  ])
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Build payload with multiple attachments multi-part model', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
      { 'type': 'text', 'text': 'attachment' },
    ]},
  ])

  messages[1].detach(messages[1].attachments[0]) // remove image attachment
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1' },
      { 'type': 'text', 'text': 'attachment' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])
})

test('Build payload with multiple attachments not multi-part model', async () => {
  const openai = new OpenAI({ baseURL: 'https://api.unknown.com' })
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  messages[1].attach(new Attachment('attachment', 'text/plain'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1\n\nattachment' },
      { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
    ]},
  ])

  messages[1].detach(messages[1].attachments[0]) // remove image attachment
  messages[1].attach(new Attachment('image', 'image/png'))
  expect(openai.buildPayload(openai.buildModel('gpt-4-vision'), messages)).toStrictEqual([
    { role: 'system', content: 'instructions' },
    { role: 'user', content: [
      { type: 'text', text: 'prompt1\n\nattachment' },
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
  const response = await openai.complete(openai.buildModel('model'), messages)
  expect(response).toStrictEqual({ type: 'text', 'content': 'response', toolCalls: [] })
})

test('Generate content', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  const stream = openai.generate(openai.buildModel('model'), messages)
  expect(stream).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    if (chunk.type == 'content') response += chunk.text
    else if (chunk.type == 'tool') toolCalls.push(chunk)
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith(['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 1, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
})

test('Switch to vision when model provided', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate(openai.buildModel('model-no-tool'), messages, {
    visionFallbackModel: openai.buildModel('model-vision'),
  })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-vision', stream: true, stream_options: { include_usage: false },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [
        { type: 'text', text: 'prompt1' },
        { 'type': 'image_url', 'image_url': { 'url': 'data:image/png;base64,image' } },
      ]}
    ]
  })
})

test('Cannot switch to vision if not models provided', async () => {
  const openai = new OpenAI(config)
  const messages = [
    new Message('system', 'instructions'),
    new Message('user', 'prompt1'),
  ]
  messages[1].attach(new Attachment('image', 'image/png'))
  const stream = await openai.generate(openai.buildModel('model-no-tool'), messages, { visionFallbackModel: undefined })
  // eslint-disable-next-line no-empty,@typescript-eslint/no-unused-vars
  for await (const chunk of stream) { }
  expect(_openai.default.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model-no-tool', stream: true, stream_options: { include_usage: false },
    messages: [
      { role: 'system', content: 'instructions' },
      { role: 'user', content: [{ type: 'text', text: 'prompt1' }] }
    ]
  })
})

test('Does not add the same plugin twice', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin1())
  openai.addPlugin(new Plugin2())
  openai.addPlugin(new Plugin2())
  expect(openai.plugins.length).toBe(2)
})
