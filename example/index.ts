
import { EngineConfig, Message, igniteEngine, loadOpenAIModels } from '../src/index'
import Answer from './answer'

// we need an api key
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is not set')
}

(async () => {

  // initialize
  let config: EngineConfig = { apiKey: process.env.API_KEY }
  const openai = igniteEngine('openai', config)
  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'What is the capital of France?'),
  ]

  // load models
  console.log('\n** Load models')
  await loadOpenAIModels(config)
  console.log(`${config.models.chat.length} chat models found`)
  console.log(`${config.models.image.length} image models found`)

  // completion mode
  console.log('\n** Chat completion')
  console.log(await openai.complete(messages, { model: 'gpt-4o' }))

  // streaming mode
  console.log('\n** Chat streaming')
  const stream1 = await openai.stream(messages, { model: 'gpt-4o' })
  for await (const chunk of stream1) {
    console.log(await openai.streamChunkToLlmChunk(chunk, () => {}))
  }

  // function calling
  console.log('\n** Function calling')
  const answer = new Answer({})
  openai.addPlugin(answer)
  messages[1].content = 'What is the answer to life, the universe and everything?'
  let stream2 = await openai.stream(messages, { model: 'gpt-4o' })
  while (stream2) {
    let stream3 = null
    for await (const chunk of stream2) {
      const msg = await openai.streamChunkToLlmChunk(chunk, (ev) => {
        if (ev.type === 'stream') {
          stream3 = ev.content
        }
      })
      if (msg) {
        console.log(msg)
      }
    }
    stream2 = stream3
  }

})()
