
import { EngineCreateOpts, LlmEngine, Message, igniteEngine, loadModels } from '../src/index'
import Answer from './answer'
import dotenv from 'dotenv';
dotenv.config();

const completion = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat completion')
  console.log(await llm.complete(model, messages, { usage: true }))
}

const streaming = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat streaming')
  const stream = llm.generate(model, messages, { usage: true, reasoning: true })
  let reasoning = ''
  let response = ''
  for await (const chunk of stream) {
    console.log(chunk)
    if (chunk.type === 'reasoning') {
      reasoning += chunk.text
    }
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(reasoning)
  console.log(response)
}

const conversation = async (llm: LlmEngine, model: string, messages: Message[]) => {
  console.log('\n** Chat conversation')
  const AssistantMessage = new Message('assistant', '')
  let stream = llm.generate(model, messages)
  let response = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content' || chunk.type === 'reasoning') {
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
  const stream = llm.generate(model, messages, { usage: true, reasoning: true })
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
  const model = process.env.MODEL ?? 'gpt-4o-mini'
  const baseURL = process.env.BASE_URL ?? undefined

  // we need an api key
  const apiKey = process.env.API_KEY || process.env[`${engine.toUpperCase()}_API_KEY`]
  if (engine !== 'ollama' && !apiKey) {
    throw new Error('API_KEY environment variable is not set')
  }

  // start the engine
  const config: EngineCreateOpts = {
    apiKey: apiKey,
    baseURL: baseURL
  }
  const llm = igniteEngine(engine, config)
  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'What is the capital of France?'),
  ]

  // load models
  console.log('\n** Load models')
  const models = await loadModels(engine, config)
  console.log(`${models!.chat.length} chat models found`)
  // for (const model of models!.chat) {
  //   console.log(`- ${model.id}: ${model.name}`)
  // }
  console.log(`${models!.image?.length ?? 0} image models found`)
  console.log(`${models!.embedding?.length ?? 0} embedding models found`)

  // each demo
  await completion(llm, model, messages)
  await streaming(llm, model, messages)
  await conversation(llm, model, messages)
  await tooling(llm, model, messages)

})()
