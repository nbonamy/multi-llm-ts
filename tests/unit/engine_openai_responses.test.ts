import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin2 } from '../mocks/plugins'
import Message from '../../src/models/message'
import OpenAI from '../../src/providers/openai'
import * as _openai from 'openai'
import { EngineCreateOpts } from '../../src/types/index'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

let callCount = 0

vi.mock('openai', async () => {
  
  const OpenAI = vi.fn((opts: _openai.ClientOptions) => {
    OpenAI.prototype.apiKey = opts.apiKey
    OpenAI.prototype.baseURL = opts.baseURL
  })
  
  OpenAI.prototype.responses = {
    create: vi.fn((opts: any) => {
      if (opts.stream) {

        return {
          async * [Symbol.asyncIterator]() {
            // response.created
            yield {
              type: 'response.created',
              response: {
                id: 'resp_123',
                status: 'in_progress'
              }
            }

            // response.in_progress
            yield {
              type: 'response.in_progress',
              response: {
                id: 'resp_123',
                status: 'in_progress'
              }
            }

            // response.output_item.added (message) - no tools
            yield {
              type: 'response.output_item.added',
              item: {
                id: 'msg_123',
                type: 'message'
              }
            }

            // response.output_text.delta
            const content = `response${callCount+1}`
            for (let i = 0; i < content.length; i++) {
              yield {
                type: 'response.output_text.delta',
                delta: content[i]
              }
            }

            // response.output_item.done (message)
            yield {
              type: 'response.output_item.done',
              item: {
                id: 'msg_123',
                type: 'message'
              }
            }

            if (callCount === 0 && opts.tools?.length) {

              callCount = 1

              // response.output_item.added (function_call)
              yield {
                type: 'response.output_item.added',
                item: {
                  id: 'func_call_123',
                  type: 'function_call',
                  name: 'plugin2',
                  call_id: 'call_123',
                  arguments: ''
                }
              }

              // response.function_call_arguments.delta
              const args = '["arg"]'
              for (let i = 0; i < args.length; i++) {
                yield {
                  type: 'response.function_call_arguments.delta',
                  item_id: 'func_call_123',
                  delta: args[i]
                }
              }

              // response.function_call_arguments.done
              yield {
                type: 'response.function_call_arguments.done',
                item_id: 'func_call_123'
              }

              // response.output_item.done (function_call)
              yield {
                type: 'response.output_item.done',
                item: {
                  id: 'func_call_123',
                  type: 'function_call'
                }
              }

              // response.output_item.added (message)
              yield {
                type: 'response.output_item.added',
                item: {
                  id: 'msg_123',
                  type: 'message'
                }
              }

            }

            // response.completed
            yield {
              type: 'response.completed',
              response: {
                id: 'resp_123',
                status: 'completed',
                usage: {
                  input_tokens: 10,
                  output_tokens: 20,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 0 }
                }
              }
            }
          }
        }

      } else {
      
        // Non-streaming response
        if (callCount == 0 && opts.tools?.length) {

          callCount = 1
          
          // Response with tool calls
          return {
            id: 'resp_123',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                id: 'func_call_123',
                name: 'plugin2',
                call_id: 'call_123',
                arguments: '["arg"]'
              }
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 }
            }
          }
        } else {

          return {
            id: 'resp_123',
            status: 'completed',
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: 'response text'
                  }
                ]
              }
            ],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 }
            }
          }
        }
      }
    })
  }

  return { default: OpenAI }
})

const config: EngineCreateOpts = {
  apiKey: '123',
}

beforeEach(() => {
  vi.clearAllMocks();
  callCount = 0
})

test('OpenAI Responses API completion without tools', async () => {
  const openai = new OpenAI(config)
  const response = await openai.complete(openai.buildModel('gpt-4'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { 
    useOpenAIResponsesApi: true,
    tools: false 
  })

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledWith({
    model: 'gpt-4',
    instructions: 'instruction',
    input: [ { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prompt', }] } ],
    stream: false
  })

  expect(response).toStrictEqual({
    type: 'text',
    content: 'response text',
    toolCalls: [],
    openAIResponseId: 'resp_123'
  })
})

test('OpenAI Responses API completion with tools', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())
  
  const response = await openai.complete(openai.buildModel('gpt-4'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { 
    useOpenAIResponsesApi: true,
    usage: true
  })

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledTimes(2)
  
  // First call
  expect(_openai.default.prototype.responses.create).toHaveBeenNthCalledWith(1, {
    model: 'gpt-4',
    instructions: 'instruction',
    input: [ { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prompt', }] } ],
    stream: false,
    tools: expect.arrayContaining([
      expect.objectContaining({
        parameters: expect.objectContaining({
          additionalProperties: false,
          required: ['param1', 'param2', 'param3', 'param4', 'param5', 'param6', 'param7', 'param8']
        })
      }),
    ]),
    tool_choice: 'auto'
  })

  // Second call (follow-up)
  expect(_openai.default.prototype.responses.create).toHaveBeenNthCalledWith(2, {
    model: 'gpt-4',
    previous_response_id: 'resp_123',
    input: [
      {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'result2'
      }
    ],
    stream: false
  })

  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'gpt-4' }, ['arg'])

  expect(response).toStrictEqual({
    type: 'text',
    content: 'response text',
    toolCalls: [
      {
        name: 'plugin2',
        params: ['arg'],
        result: 'result2'
      }
    ],
    openAIResponseId: 'resp_123',
    usage: {
      prompt_tokens: 20,
      completion_tokens: 40,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0
      }
    }
  })
})

test('OpenAI Responses API stream without tools', async () => {
  const openai = new OpenAI(config)
  const { stream, context } = await openai.stream(openai.buildModel('gpt-4'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { 
    useOpenAIResponsesApi: true,
    tools: false,
    usage: true
  })

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledWith({
    model: 'gpt-4',
    instructions: 'instruction',
    input: [ { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prompt', }] } ],
    stream: true
  })

  expect(context.responsesApi).toBe(true)
  expect(stream).toBeDefined()

  let response = ''
  let usageChunk = null
  let messageId = null
  let lastMsg: LlmChunkContent | null = null
  
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      response += chunk.text
      lastMsg = chunk
    } else if (chunk.type === 'usage') {
      usageChunk = chunk
    } else if (chunk.type === 'openai_message_id') {
      messageId = chunk.id
    }
  }

  expect(response).toBe('response1')
  expect(messageId).toBe('resp_123')
  expect(lastMsg?.done).toBe(true)
  expect(usageChunk).toStrictEqual({
    type: 'usage',
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0
      }
    }
  })
})

test('OpenAI Responses API stream with tools', async () => {

  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  const { stream, context } = await openai.stream(openai.buildModel('gpt-4'), [
    new Message('system', 'instruction'),
    new Message('user', 'prompt'),
  ], { 
    useOpenAIResponsesApi: true,
    usage: true
  })

  expect(context.responsesApi).toBe(true)
  expect(stream).toBeDefined()

  let response = ''
  let usageChunk = null
  let lastMsg: LlmChunkContent | null = null
  const toolCalls: LlmChunk[] = []
  
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      response += chunk.text
      lastMsg = chunk
    } else if (chunk.type === 'tool') {
      toolCalls.push(chunk)
    } else if (chunk.type === 'usage') {
      usageChunk = chunk
    }
  }

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledTimes(2)
  
  // First call
  expect(_openai.default.prototype.responses.create).toHaveBeenNthCalledWith(1, {
    model: 'gpt-4',
    instructions: 'instruction',
    input: [ { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prompt', }] } ],
    stream: true,
    tools: expect.any(Array),
    tool_choice: 'auto'
  })

  // Second call (follow-up)
  expect(_openai.default.prototype.responses.create).toHaveBeenNthCalledWith(2, {
    model: 'gpt-4',
    previous_response_id: 'resp_123',
    input: [
      {
        type: 'function_call_output',
        call_id: 'call_123',
        output: 'result2'
      }
    ],
    tools: expect.any(Array),
    tool_choice: 'auto',
    stream: true
  })

  expect(Plugin2.prototype.execute).toHaveBeenCalledWith({ model: 'gpt-4' }, ['arg'])
  expect(response).toBe('response1response2')
  expect(lastMsg?.done).toBe(true)

  // Check tool call sequence
  expect(toolCalls).toHaveLength(3)
  expect(toolCalls[0]).toStrictEqual({
    type: 'tool',
    id: 'func_call_123',
    name: 'plugin2',
    status: 'prep2',
    done: false
  })
  expect(toolCalls[1]).toStrictEqual({
    type: 'tool',
    id: 'func_call_123',
    name: 'plugin2',
    status: 'run2',
    call: { params: ['arg'], result: undefined },
    done: false
  })
  expect(toolCalls[2]).toStrictEqual({
    type: 'tool',
    id: 'func_call_123',
    name: 'plugin2',
    status: undefined,
    call: { params: ['arg'], result: 'result2' },
    done: true
  })

  expect(usageChunk).toStrictEqual({
    type: 'usage',
    usage: {
      prompt_tokens: 20,
      completion_tokens: 40,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0
      }
    }
  })
})

test('OpenAI Responses API forced usage', async () => {
  const openai = new OpenAI(config)
  
  // Test that o3-pro model forces responses api
  const o3ProModel = openai.buildModel('o3-pro-128k')
  expect(openai.modelRequiresResponsesApi(o3ProModel)).toBe(true)
  
  // Test config flag
  const openaiWithResponsesApi = new OpenAI({ ...config, useOpenAIResponsesApi: true })
  
  // Test via actual usage since shouldUseResponsesApi is protected
  await openaiWithResponsesApi.complete(openai.buildModel('gpt-4'), [
    new Message('user', 'test')
  ])
  
  // Should have called responses.create since config flag is set
  expect(_openai.default.prototype.responses.create).toHaveBeenCalled()
})

test('OpenAI Responses API tool choice', async () => {
  const openai = new OpenAI(config)
  openai.addPlugin(new Plugin2())

  await openai.stream(openai.buildModel('gpt-4'), [
    new Message('user', 'prompt'),
  ], { 
    useOpenAIResponsesApi: true,
    toolChoice: { type: 'tool', name: 'plugin2' }
  })

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledWith(
    expect.objectContaining({
      tool_choice: {
        type: 'function',
        name: 'plugin2'
      }
    })
  )
})

test('OpenAI Responses API multiple system messages', async () => {
  const openai = new OpenAI(config)
  
  await openai.complete(openai.buildModel('gpt-4'), [
    new Message('system', 'You are helpful'),
    new Message('system', 'Be concise'),
    new Message('user', 'prompt'),
  ], { useOpenAIResponsesApi: true })

  expect(_openai.default.prototype.responses.create).toHaveBeenCalledWith({
    model: 'gpt-4',
    instructions: 'You are helpful\nBe concise',
    input: [ { type: 'message', role: 'user', content: [{
      type: 'input_text',
      text: 'prompt',
    }] } ],
    stream: false
  })
})
