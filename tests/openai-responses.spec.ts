import { expect, test, vi } from 'vitest'

// System under test
import OpenAIEngine, { modelSupportsResponses } from '../src/providers/openai'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// Intercept the `openai` HTTP client so no real network calls are performed.
vi.mock('openai', () => {
  const fakeResponse = {
    choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 }
  }
  const OpenAI = vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(fakeResponse)
      }
    },
    responses: {
      // non-streaming call
      create: vi.fn().mockImplementation((req:any)=>{
        if (req.stream) {
          // return async iterable for streaming
          return (async function*(){
            // minimal streaming lifecycle: emit completed event then done
            yield { type: 'response_completed', id: 'resp_123' }
          })()
        }
        return Promise.resolve({ output: '', usage: { input_tokens: 1, output_tokens: 1 } })
      })
    }
  }))
  return { default: OpenAI }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('modelSupportsResponses() returns true for o3-pro, false for gpt-4o', () => {
  expect(modelSupportsResponses('o3-pro')).toBe(true)
  expect(modelSupportsResponses('gpt-4o')).toBe(false)
})

test('OpenAI.chat() succeeds for a responses-capable model', async () => {
  const engine = new OpenAIEngine({ apiKey: 'dummy' })
  
  const res = await engine.chat(engine.buildModel('o3-pro') as any, [])
  expect(res).toBeDefined()
})

test('Automatic fallback works for non-responses model', async () => {
  const engine = new OpenAIEngine({ apiKey: 'dummy' })
  
  const res = await engine.chat(engine.buildModel('gpt-4o') as any, [])
  expect(res).toBeDefined()
})

test('responsesStream() returns a streaming response object', async () => {
  const engine = new OpenAIEngine({ apiKey: 'dummy' })
  
  const streaming = await engine.responsesStream(engine.buildModel('o3-pro') as any, [])
  expect(streaming).toHaveProperty('stream')
})
