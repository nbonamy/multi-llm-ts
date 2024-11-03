
import { EngineCreateOpts, LlmEngine, Message, igniteEngine, loadOpenAIModels } from '../src/index'
import Answer from './answer'

// we need an api key
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is not set')
}

const completion = async (llm: LlmEngine, messages: Message[]) => {
  console.log('\n** Chat completion')
  console.log(await llm.complete('gpt-3.5-turbo', messages))
}

const streaming = async (llm: LlmEngine, messages: Message[]) => {
  console.log('\n** Chat streaming')
  const stream = llm.generate('gpt-3.5-turbo', messages)
  let response = ''
  for await (const chunk of stream) {
    console.log(chunk)
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
}

const conversation = async (llm: LlmEngine, messages: Message[]) => {
  console.log('\n** Chat conversation')
  const AssistantMessage = new Message('assistant', '')
  let stream = llm.generate('gpt-3.5-turbo', messages)
  let response = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      AssistantMessage.appendText(chunk)
      response += chunk.text
    }
  }
  console.log(response)
  messages.push(AssistantMessage)
  messages.push(new Message('user', 'What is your last message?'))
  stream = llm.generate('gpt-3.5-turbo', messages)
  response = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
  messages.splice(2,2)
}

const tooling = async (llm: LlmEngine, messages: Message[]) => {
  console.log('\n** Function calling')
  const answer = new Answer()
  llm.addPlugin(answer)
  messages[1].content = 'What is the answer to life, the universe and everything?'
  const stream = llm.generate('gpt-3.5-turbo', messages)
  let response = ''
  for await (const chunk of stream) {
    console.log(chunk)
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
}

(async () => {

  // initialize
  const config: EngineCreateOpts = { apiKey: process.env.API_KEY }
  const openai = igniteEngine('openai', config)
  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'What is the capital of France?'),
  ]

  // load models
  console.log('\n** Load models')
  const models = await loadOpenAIModels(config)
  console.log(`${models.chat.length} chat models found`)
  console.log(`${models.image.length} image models found`)

  // each demo
  await completion(openai, messages)
  await streaming(openai, messages)
  await conversation(openai, messages)
  await tooling(openai, messages)

})()
