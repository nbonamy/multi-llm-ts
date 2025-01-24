
import { vi, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import Anthropic from '../../src/providers/anthropic'
import dotenv from 'dotenv'

test('Antrophic real test', async (context) => {

  // check flag
  if (!process.env.REAL_API) {
    console.log('REAL_API flag not set. Skipping')
    context.skip()
  }

  // check config
  dotenv.config()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.log('Anthropic API key not found')
    context.skip()
  }

  // disable mock
  vi.unmock('@anthropic-ai/sdk')

  // create engine
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })
  anthropic.addPlugin(new Plugin1())
  anthropic.addPlugin(new Plugin2())
  anthropic.addPlugin(new Plugin3())
  await expect(anthropic.stream('claude-3-5-sonnet-latest', [
    new Message('system', 'instruction'),
    new Message('user', 'prompt', new Attachment('document', 'text/plain')),
  ])).resolves.toBeTruthy()

})
