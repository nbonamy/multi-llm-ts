
import { z } from 'zod'
import { ChatModel, EngineCreateOpts, LlmEngine, Message, igniteEngine, loadModels } from '../src/index'
import Answer from './answer'
import dotenv from 'dotenv';
dotenv.config();

const completion = async (llm: LlmEngine, model: ChatModel, messages: Message[]) => {
  console.log('\n** Chat completion' + (llm.plugins.length ? ' with plugins' : ''))
  console.log(await llm.complete(model, messages, { usage: true }))
}

const streaming = async (llm: LlmEngine, model: ChatModel, messages: Message[]) => {
  console.log('\n** Chat streaming' + (llm.plugins.length ? ' with plugins' : ''))
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

const conversation = async (llm: LlmEngine, model: ChatModel, messages: Message[]) => {
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

const structured = async (llm: LlmEngine, model: ChatModel, messages: Message[]) => {
  console.log('\n** Structured Output' + (llm.plugins.length ? ' with plugins' : ''))
  console.log(await llm.complete(model, messages, {
    structuredOutput: {
      name: 'items',
      structure: z.object({
        items: z.array(z.object({
          name: z.string(),
          description: z.string(),
          price: z.number(),
        })),
      }),
    },
  }))
}

(async () => {

  // initialize
  const engine = process.env.ENGINE ?? 'openai'
  const modelName = process.env.MODEL ?? 'gpt-4.1'
  const baseURL = process.env.BASE_URL ?? process.env.ENDPOINT ?? undefined
  const deployment = process.env.DEPLOYMENT ?? undefined
  const apiVersion = process.env.API_VERSION ?? undefined

  // we need an api key
  const apiKey = process.env.API_KEY || process.env[`${engine.toUpperCase()}_API_KEY`]
  if (engine !== 'ollama' && engine !== 'lmstudio' && !apiKey) {
    throw new Error('API_KEY environment variable is not set')
  }

  // start the engine
  const config: EngineCreateOpts = {
    apiKey: apiKey,
    baseURL: baseURL,
    deployment: deployment,
    apiVersion: apiVersion,
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
  console.log(`${models!.video?.length ?? 0} video models found`)
  console.log(`${models!.embedding?.length ?? 0} embedding models found`)
  console.log(`${models!.realtime?.length ?? 0} realtime models found`)
  console.log(`${models!.computer?.length ?? 0} computer use models found`)
  console.log(`${models!.tts?.length ?? 0} tts models found`)
  console.log(`${models!.stt?.length ?? 0} stt models found`)

  // get the model
  const model = models!.chat.find(m => m.id === modelName)
  if (!model) {
    throw new Error(`Model ${modelName} not found`)
  }

  // no function calling
  await completion(llm, model, messages)
  await streaming(llm, model, messages)
  await conversation(llm, model, messages)

  // with function calling
  messages[1].content = 'What is the answer to life, the universe and everything?'
  llm.addPlugin(new Answer())
  await completion(llm, model, messages)
  await streaming(llm, model, messages)

  // structured outputs
  await structured(llm, model, [
    new Message('system', 'You are a helpful math tutor.'),
    new Message('user', 'create a JSON list of random items'),
  ])

})()
