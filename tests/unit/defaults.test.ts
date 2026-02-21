
import { expect, test } from 'vitest'
import { PROVIDER_BASE_URLS, getProviderBaseURL } from '../../src/defaults'

test('PROVIDER_BASE_URLS has all providers', () => {
  const expectedProviders = [
    'openai', 'anthropic', 'cerebras', 'deepseek',
    'google', 'groq', 'lmstudio', 'meta', 'mistralai',
    'ollama', 'openrouter', 'xai', 'together',
  ]
  for (const provider of expectedProviders) {
    expect(PROVIDER_BASE_URLS).toHaveProperty(provider)
  }
})

test('All non-azure providers have string URLs', () => {
  for (const [,url] of Object.entries(PROVIDER_BASE_URLS)) {
    expect(url).toBeTypeOf('string')
    expect(url!.startsWith('http')).toBe(true)
  }
})

test('getProviderBaseURL returns correct URLs', () => {
  expect(getProviderBaseURL('openai')).toBe('https://api.openai.com/v1')
  expect(getProviderBaseURL('xai')).toBe('https://api.x.ai/v1')
})

test('getProviderBaseURL returns null for unknown provider', () => {
  expect(getProviderBaseURL('nonexistent')).toBeNull()
})
