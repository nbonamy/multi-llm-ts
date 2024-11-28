
import { EngineCreateOpts, LlmEngine, Message, igniteEngine, loadModels } from '../src/index'
import Answer from './answer'

// we need an api key
if (!process.env.API_KEY) {
  throw new Error('API_KEY environment variable is not set')
}

const completion = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat completion')
  console.log(await llm.complete(model, messages, { usage: true }))
}

const streaming = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat streaming')
  const stream = llm.generate(model, messages, { usage: true })
  let response = ''
  for await (const chunk of stream) {
    console.log(chunk)
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
}

const conversation = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat conversation')
  const AssistantMessage = new Message('assistant', '')
  let stream = llm.generate(model, messages)
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
  stream = llm.generate(model, messages)
  response = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
  messages.splice(2,2)
}

const tooling = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Function calling')
  const answer = new Answer()
  llm.addPlugin(answer)
  messages[1].content = 'What is the answer to life, the universe and everything?'
  const stream = llm.generate(model, messages, { usage: true })
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
  const engine = process.env.ENGINE ?? 'openai'
  const model = process.env.MODEL ?? 'gpt-3.5-turbo'
  const config: EngineCreateOpts = { apiKey: process.env.API_KEY }
  const llm = igniteEngine(engine, config)
  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'What is the capital of France?'),
  ]

  // load models
  console.log('\n** Load models')
  const models = await loadModels(engine, config)
  console.log(`${models.chat.length} chat models found`)
  console.log(`${models.image?.length ?? 0} image models found`)

  // each demo
  await completion(llm, model, messages)
  await streaming(llm, model, messages)
  await conversation(llm, model, messages)
  await tooling(llm, model, messages)

})()
