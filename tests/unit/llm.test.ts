
import { expect, test } from 'vitest'
import { igniteEngine, hasVisionModels, isVisionModel, loadModels } from '../../src/llm'
import OpenAI from '../../src/providers/openai'
import Ollama from '../../src/providers/ollama'
import MistralAI from '../../src/providers/mistralai'
import Anthropic from '../../src/providers/anthropic'
import Google from '../../src/providers/google'
import XAI from '../../src/providers/xai'
import DeepSeek from '../../src/providers/deepseek'
import OpenRouter from '../../src/providers/openrouter'
import Groq from '../../src/providers/groq'
import Cerebras from '../../src/providers/cerebras'

const config = { apiKey: '123' }

test('Invalid engine', async () => {
  await expect(async() => await igniteEngine('invalid', config)).rejects.toThrowError(/Unknown engine/)
  await expect(async() => await loadModels('invalid', config)).rejects.toThrowError(/Unknown engine/)
})

test('Ignite Engine', async () => {
  expect(await igniteEngine('openai', config)).toBeInstanceOf(OpenAI)
  expect(await igniteEngine('ollama', config)).toBeInstanceOf(Ollama)
  expect(await igniteEngine('mistralai', config)).toBeInstanceOf(MistralAI)
  expect(await igniteEngine('anthropic', config)).toBeInstanceOf(Anthropic)
  expect(await igniteEngine('google', config)).toBeInstanceOf(Google)
  expect(await igniteEngine('xai', config)).toBeInstanceOf(XAI)
  expect(await igniteEngine('deepseek', config)).toBeInstanceOf(DeepSeek)
  expect(await igniteEngine('openrouter', config)).toBeInstanceOf(OpenRouter)
  expect(await igniteEngine('groq', config)).toBeInstanceOf(Groq)
  expect(await igniteEngine('cerebras', config)).toBeInstanceOf(Cerebras)
  await expect(async() => await igniteEngine('aws', config)).rejects.toThrowError(/Unknown engine/)
})

test('Has Vision Models', async () => {
  expect(hasVisionModels('openai', config)).toBe(true)
  expect(hasVisionModels('ollama', config)).toBe(true)
  expect(hasVisionModels('mistralai', config)).toBe(false)
  expect(hasVisionModels('anthropic', config)).toBe(true)
  expect(hasVisionModels('google', config)).toBe(true)
  expect(hasVisionModels('xai', config)).toBe(true)
  expect(hasVisionModels('deepseek', config)).toBe(false)
  expect(hasVisionModels('openrouter', config)).toBe(false)
  expect(hasVisionModels('groq', config)).toBe(true)
  expect(hasVisionModels('cerebras', config)).toBe(false)
})

test('Is Vision Model', async () => {
  expect(isVisionModel('openai', 'model', config)).toBe(false)
  expect(isVisionModel('openai', 'vision', config)).toBe(true)
})
