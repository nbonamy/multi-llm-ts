
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

const realApiTest = async (engine, apiKey, model) => {

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

  // add plugins
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())

  // with different attachements
  const stream = llm.generate(model, [
    new Message('system', 'instruction'),
    new Message('user', 'prompt', new Attachment('document', 'text/plain')),
    new Message('assistant', 'hello, how can I help you?'),
    new Message('user', 'I need help with this', new Attachment('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'image/png')),
  ])

  // iterate
  let lastChunk: LlmChunk|null = null
  for await (const chunk of stream) {
    expect(['content', 'tool']).toContain(chunk.type)
    lastChunk = chunk
  }

  // check last chunk
  expect((lastChunk as LlmChunkContent)?.done).toBeTruthy()

}

test('OpenAI real test', async () => {
  await realApiTest('openai', process.env.OPENAI_API_KEY, 'gpt-4o-mini')
})

test('Antrophic real test', async () => {
  await realApiTest('anthropic', process.env.ANTHROPIC_API_KEY, 'claude-3-5-haiku-latest')
})

test('Google real test', async () => {
  await realApiTest('google', process.env.GOOGLE_API_KEY, 'gemini-1.5-flash-latest')
})

test('xAI real test', async () => {
  await realApiTest('xai', process.env.XAI_API_KEY, 'grok-beta')
})

test('DeepSeek real test', async () => {
  await realApiTest('deepseek', process.env.DEEPSEEK_API_KEY, 'deepseek-chat')
})

test('MistralAI real test', async () => {
  await realApiTest('mistralai', process.env.MISTRALAI_API_KEY, 'mistral-small')
})

test('OpenRouter real test', async () => {
  await realApiTest('openrouter', process.env.OPENROUTER_API_KEY, 'qwen/qwen-2-7b-instruct')
})

test('Groq real test', async () => {
  await realApiTest('groq', process.env.GROQ_API_KEY, 'llama-3.2-1b-preview')
})

test('Cerebras real test', async () => {
  await realApiTest('cerebras', process.env.CEREBRAS_API_KEY, 'llama3.1-8b')
})
