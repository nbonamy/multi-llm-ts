import { beforeAll, expect, test } from 'vitest'
import dotenv from 'dotenv'
import Message from '../../src/models/message'
import { igniteEngine } from '../../src/llm'

// Make real environment vars visible in tests
beforeAll(() => {
  dotenv.config()
})

/**
 * Run only when REAL_API flag and OPENAI_API_KEY are present. This test makes a
 * live request to the OpenAI *Responses* API capable model (o3 family).  It
 * verifies that the streaming generator yields at least one non-empty content
 * chunk.  This currently fails – serving as an executable regression guard
 * while the streaming implementation is being fixed.
 */
const shouldSkip = !process.env.REAL_API || !process.env.OPENAI_API_KEY
const modelId = process.env.OPENAI_RESPONSES_MODEL ?? 'o3'

const testFn = shouldSkip ? test.skip : test;

// ---------------------------------------------------------------------------
// Basic streaming sanity test
// ---------------------------------------------------------------------------
testFn(
  'OpenAI responses streaming yields incremental text for o3',
  { timeout: 1000 * 60 },
  async () => {
    const llm = igniteEngine('openai', {
      apiKey: process.env.OPENAI_API_KEY as string,
      preferResponses: true,
    })

    const model = llm.buildModel(modelId)

    // Simple prompt expected to stream at least a few characters.
    const stream = llm.generate(model, [
      new Message('user', 'Say hello in two short sentences.'),
    ])

    let sawNonEmpty = false

    for await (const ch of stream) {
      const chunk:any = ch as any;
      if (chunk.type === 'content' && typeof chunk.text === 'string' && chunk.text.trim().length > 0) {
        sawNonEmpty = true
        break
      }
    }

    // The current bug causes this assertion to fail, alerting us when fixed.
    expect(sawNonEmpty).toBe(true)
  },
)
