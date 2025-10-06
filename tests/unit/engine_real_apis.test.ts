
import { beforeAll, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import { LlmChunk, LlmChunkContent } from '../../src/types/llm'
import { igniteEngine } from '../../src/llm'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import dotenv from 'dotenv'

beforeAll(() => {
  dotenv.config()
})

const realApiTest = async (engine: string, apiKey: string|undefined, modelName: string) => {

  // check flag
  if (!process.env.REAL_API) {
    console.log('REAL_API flag not set. Skipping')
    return
  }

  // check api key
  if (!apiKey) {
    console.log(`${engine} API key not found`)
    return
  }

  // create engine
  const llm = igniteEngine(engine, {
    apiKey,
  })

  // build model
  const model = llm.buildModel(modelName)

  // add plugins
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())

  // completion with tools
  const response = await llm.complete(model, [
    new Message('system', 'instruction'),
    new Message('user', 'hello'),
  ])
  expect(response.content).toBeTruthy()

  // with different attachements
  const stream = llm.generate(model, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt', new Attachment('document', 'text/plain')),
    new Message('assistant', 'hello, how can I help you?'),
    new Message('user', 'I need help with this', new Attachment('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'image/png')),
  ], {
    contextWindowSize: 1000,
    maxTokens: 200,
    temperature: 1.0,
    top_k: 4,
    top_p: 0.5,
    reasoningEffort: 'low',
    caching: true,
  })

  // iterate
  let lastChunk: LlmChunk|null = null
  for await (const chunk of stream) {
    expect(['reasoning', 'content', 'tool', 'openai_message_id']).toContain(chunk.type)
    lastChunk = chunk
  }

  // check last chunk
  expect((lastChunk as LlmChunkContent)?.done).toBeTruthy()

}

test.concurrent('OpenAI real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('openai', process.env.OPENAI_API_KEY, 'gpt-4o-mini')
})

test.concurrent('OpenAI Responses real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('openai', process.env.OPENAI_API_KEY, 'o3-pro')
})

test.concurrent('Antrophic real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('anthropic', process.env.ANTHROPIC_API_KEY, 'claude-3-5-haiku-latest')
})

test.concurrent('Google real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('google', process.env.GOOGLE_API_KEY, 'gemini-2.0-flash')
})

test.concurrent('xAI real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('xai', process.env.XAI_API_KEY, 'grok-3-mini-fast-beta')
})

test.concurrent('Meta real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('meta', process.env.META_API_KEY, 'Llama-3.3-8B-Instruct')
})

test.concurrent('DeepSeek real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('deepseek', process.env.DEEPSEEK_API_KEY, 'deepseek-chat')
})

test.concurrent('MistralAI real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('mistralai', process.env.MISTRALAI_API_KEY, 'mistral-small')
})

test.concurrent('OpenRouter real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('openrouter', process.env.OPENROUTER_API_KEY, 'qwen/qwen-2.5-7b-instruct')
})

test.concurrent('Groq real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('groq', process.env.GROQ_API_KEY, 'openai/gpt-oss-20b')
})

test.concurrent('Cerebras real test', { timeout: 1000 * 60 }, async () => {
  await realApiTest('cerebras', process.env.CEREBRAS_API_KEY, 'llama3.1-8b')
})
