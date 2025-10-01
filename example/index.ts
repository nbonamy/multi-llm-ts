
import dotenv from 'dotenv';
import { z } from 'zod';
import { EngineCreateOpts, LlmModel, Message, igniteModel, loadModels } from '../src/index';
import Answer from './answer';
dotenv.config();

const completion = async (model: LlmModel, messages: Message[]) => {
  console.log('\n** Chat completion' + (model.plugins.length ? ' with plugins' : ''))
  console.log(await model.complete(messages, { usage: true }))
}

const streaming = async (model: LlmModel, messages: Message[]) => {
  console.log('\n** Chat streaming' + (model.plugins.length ? ' with plugins' : ''))
  const stream = model.generate(messages, { usage: true, reasoning: true })
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

const conversation = async (model: LlmModel, messages: Message[]) => {
  console.log('\n** Chat conversation')
  const AssistantMessage = new Message('assistant', '')
  let stream = model.generate(messages)
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
  stream = model.generate(messages)
  response = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      response += chunk.text
    }
  }
  console.log(response)
  messages.splice(2,2)
}

const structured = async (model: LlmModel, messages: Message[]) => {
  console.log('\n** Structured Output' + (model.plugins.length ? ' with plugins' : ''))
  console.log(await model.complete(messages, {
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
  const chatModel = models!.chat.find(m => m.id === modelName)
  if (!chatModel) {
    throw new Error(`Model ${modelName} not found`)
  }

  const model = igniteModel(engine, chatModel, config)

  // no function calling
  await completion(model, messages)
  await streaming(model, messages)
  await conversation(model, messages)

  // with function calling
  messages[1].content = 'What is the answer to life, the universe and everything?'
  model.addPlugin(new Answer())
  await completion(model, messages)
  await streaming(model, messages)

  // structured outputs
  await structured(model, [
    new Message('system', 'You are a helpful math tutor.'),
    new Message('user', 'create a JSON list of random items'),
  ])

})()
