import { expect, test } from 'vitest'
import dotenv from 'dotenv'
import Message from '../../src/models/message'
import { igniteEngine } from '../../src/llm'
import Answer from '../../example/answer'

dotenv.config()

const shouldSkip = !process.env.REAL_API || !process.env.OPENAI_API_KEY
const testFn = shouldSkip ? test.skip : test
const modelId = process.env.OPENAI_RESPONSES_MODEL ?? 'o3'

testFn(
  'OpenAI responses full scenario with plugin and history',
  { timeout: 1000 * 120 },
  async () => {
    const llm = igniteEngine('openai', {
      apiKey: process.env.OPENAI_API_KEY as string,
      preferResponses: true,
    })
    const model = llm.buildModel(modelId)

    // -------------------------------------------------------------------
    // 1. Initial completion & streaming
    // -------------------------------------------------------------------
    const messages = [
      new Message('system', 'You are a helpful assistant'),
      new Message('user', 'What is the capital of France?'),
    ]

    // Completion (non-stream)
    const completion = await llm.complete(model, messages, { usage: true })
    expect(completion.content?.trim().length).toBeGreaterThan(0)

    // Streaming – must produce incremental content
    const stream1 = llm.generate(model, messages, { usage: true })
    let streamed1 = ''
    for await (const ch of stream1) {
      const chunk: any = ch as any
      if (chunk.type === 'content') streamed1 += chunk.text
    }
    expect(streamed1.trim().length).toBeGreaterThan(0)

    // -------------------------------------------------------------------
    // 2. Conversation follow-up (history)
    // -------------------------------------------------------------------
    const assistantMsg = new Message('assistant', streamed1)
    messages.push(assistantMsg)
    messages.push(new Message('user', 'What was my last question?'))

    const stream2 = llm.generate(model, messages)
    let convoResponse = ''
    for await (const ch of stream2) {
      const chunk: any = ch as any
      if (chunk.type === 'content') convoResponse += chunk.text
    }
    expect(convoResponse.trim().length).toBeGreaterThan(0)

    // -------------------------------------------------------------------
    // 3. Plugin scenario – Answer plugin and function calling
    // -------------------------------------------------------------------
    messages[1].content = 'What is the answer to life, the universe and everything?'
    llm.addPlugin(new Answer())

    const stream3 = llm.generate(model, messages, { usage: true, reasoning: true })
    let sawTool = false
    let pluginContent = ''

    for await (const ch of stream3) {
      const chunk: any = ch as any
      const t = (chunk.type as string)
      if (t.toLowerCase().includes('tool')) {
        sawTool = true
      }
      if (t === 'content') {
        pluginContent += chunk.text
      }
    }

    expect(pluginContent.trim().length).toBeGreaterThan(0)
    expect(sawTool).toBe(true)
  },
)
