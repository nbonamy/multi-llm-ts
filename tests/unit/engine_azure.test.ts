
import { EngineCreateOpts } from '../../src/types/index'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { loadAzureModels, loadModels } from '../../src/llm'
import Message from '../../src/models/message'
import Azure from '../../src/providers/azure'
import { AzureClientOptions, AzureOpenAI } from 'openai'
import { LlmChunk } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

vi.mock('openai', async () => {
  const OpenAI = vi.fn()
  const AzureOpenAI = vi.fn((opts: AzureClientOptions) => {
    AzureOpenAI.prototype.apiKey = opts.apiKey
    AzureOpenAI.prototype.baseURL = opts.baseURL
    AzureOpenAI.prototype.deployment = opts.deployment
    AzureOpenAI.prototype.apiVersion = opts.apiVersion
  })
  AzureOpenAI.prototype.chat = {
    completions: {
      create: vi.fn((opts) => {
        if (opts.stream) {
          return {
            async * [Symbol.asyncIterator]() {
              
              // first we yield tool call chunks
              yield { choices: [{ delta: { tool_calls: [ { id: 0, function: { name: 'plugin2', arguments: '[ "ar' }} ] }, finish_reason: 'none' } ] }
              yield { choices: [{ delta: { tool_calls: [ { function: { arguments: [ 'g" ]' ] } }] }, finish_reason: 'tool_calls' } ] }
              
              // now the text response
              const content = 'response'
              for (let i = 0; i < content.length; i++) {
                yield { choices: [{ delta: { content: content[i], finish_reason: 'none' } }] }
              }
              yield { choices: [{ delta: { content: '', finish_reason: 'done' } }] }
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
  return { default: OpenAI, AzureOpenAI }
})

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Azure Load Chat Models', async () => {
  const models = await loadAzureModels(config)
  expect(models!.chat).toStrictEqual([
    { id: 'default', name: 'default', meta: expect.any(Object), capabilities: { tools: true, vision: false, reasoning: false } },
  ])
  expect(models!.image).toStrictEqual([])
  expect(await loadModels('azure', config)).toStrictEqual(models)
})

test('Azure Basic', async () => {
  const azure = new Azure(config)
  expect(azure.getName()).toBe('azure')
  expect(azure.client.apiKey).toBe('123')
})

test('Azure stream', async () => {
  const azure = new Azure(config)
  azure.addPlugin(new Plugin1())
  azure.addPlugin(new Plugin2())
  azure.addPlugin(new Plugin3())
  const { stream, context } = await azure.stream(azure.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(AzureOpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    tool_choice: 'auto',
    tools: expect.any(Array),
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
  expect(stream.controller).toBeDefined()
  let response = ''
  const toolCalls: LlmChunk[] = []
  for await (const chunk of stream) {
    for await (const msg of azure.nativeChunkToLlmChunk(chunk, context)) {
      if (msg.type === 'content') response += msg.text
      if (msg.type === 'tool') toolCalls.push(msg)
    }
  }
  expect(response).toBe('response')
  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'model' }, ['arg'])
  expect(toolCalls[0]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', status: 'prep2', done: false })
  expect(toolCalls[1]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', status: 'run2', call: { params: ['arg'], result: undefined }, done: false })
  expect(toolCalls[2]).toStrictEqual({ type: 'tool', id: 0, name: 'plugin2', call: { params: ['arg'], result: 'result2' }, done: true })
  await azure.stop(stream)
  expect(stream.controller?.abort).toHaveBeenCalled()
})

test('Azure stream without tools', async () => {
  const azure = new Azure(config)
  const { stream } = await azure.stream(azure.buildModel('model'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ])
  expect(AzureOpenAI.prototype.chat.completions.create).toHaveBeenCalledWith({
    model: 'model',
    messages: [
      { role: 'system', content: 'instruction' },
      { role: 'user', content: 'prompt' }
    ],
    stream: true,
    stream_options: {
      include_usage: false
    }
  })
  expect(stream).toBeDefined()
})
