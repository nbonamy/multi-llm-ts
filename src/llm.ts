
import { EngineCreateOpts, Model, ModelsList } from 'types/index.d'
import LlmEngine from 'engine'
import Anthropic, { AnthropicComputerToolInfo } from './providers/anthropic'
import Cerebreas from './providers/cerebras'
import Google from './providers/google'
import Groq from './providers/groq'
import MistralAI from './providers/mistralai'
import Ollama from './providers/ollama'
import OpenAI from './providers/openai'
import XAI from './providers/xai'

export const igniteEngine = (engine: string, config: EngineCreateOpts): LlmEngine => {
  if (engine === 'anthropic') return new Anthropic(config)
  if (engine === 'cerebras') return new Cerebreas(config)
  if (engine === 'google') return new Google(config)
  if (engine === 'groq') return new Groq(config)
  if (engine === 'mistralai') return new MistralAI(config)
  if (engine === 'ollama') return new Ollama(config)
  if (engine === 'openai') return new OpenAI(config)
  if (engine === 'xai') return new XAI(config)
  throw new Error('Unknown engine: ' + engine)
}

export const loadModels = async (engine: string, config: EngineCreateOpts): Promise<ModelsList|null> => {
  if (engine === 'anthropic') return await loadAnthropicModels(config)
  if (engine === 'cerebras') return await loadCerebrasModels(config)
  if (engine === 'google') return await loadGoogleModels(config)
  if (engine === 'groq') return await loadGroqModels(config)
  if (engine === 'mistralai') return await loadMistralAIModels(config)
  if (engine === 'ollama') return await loadOllamaModels(config)
  if (engine === 'openai') return await loadOpenAIModels(config)
  if (engine === 'xai') return await loadXAIModels(config)
  throw new Error('Unknown engine: ' + engine)
}

export const hasVisionModels = (engine: string, config: EngineCreateOpts) => {
  const instance = igniteEngine(engine, config)
  return instance.getVisionModels().length > 0
}

export const isVisionModel = (engine: string, model: string, config: EngineCreateOpts) => {
  const instance = igniteEngine(engine, config)
  return instance.isVisionModel(model)
}

export const loadOpenAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  // load
  let models = null
  try {
    const openAI = new OpenAI(engineConfig)
    models = await openAI.getModels()
  } catch (error) {
    console.error('Error listing OpenAI models:', error);
  }
  if (!models) {
    return null
  }

  // xform
  models = models
    .sort((a, b) => a.name.localeCompare(b.name))

  // report unknown models (o1 watch)
  for (const model of models) {
    if (!model.id.startsWith('babbage-') && !model.id.startsWith('chatgpt-') && !model.id.startsWith('gpt-') &&
        !model.id.startsWith('dall-e-') && !model.id.startsWith('tts-') && !model.id.startsWith('whisper-') &&
        !model.id.startsWith('davinci-') && !model.id.startsWith('text-embedding-') && !model.id.startsWith('o1-')) {
      console.warn(`[openai] Unknown model type: ${model.id}`)
    }
  }

  // done
  return {
    chat: models.filter(model => model.id.startsWith('gpt-') || model.id.startsWith('o1-')),
    image: models.filter(model => model.id.startsWith('dall-e-'))
  }

}

export const loadOllamaModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  // needed
  const ollama = new Ollama(engineConfig)

  // load
  let models: Model[] = []
  try {
    models = await ollama.getModels()
  } catch (error) {
    console.error('Error listing Ollama models:', error);
  }
  if (!models.length) {
    return null
  }

  // get info
  const modelInfo: { [key: string]: any } = {}
  for (const model of models) {
    const info = await ollama.getModelInfo(model.id)
    modelInfo[model.id] = {
      ...info.details,
      ...info.model_info,
    }
  }

  // done
  return {
    chat: models
      .filter(model => modelInfo[model.id].family.includes('bert') === false)
      .sort((a, b) => a.name.localeCompare(b.name)),
    embedding: models
      .filter(model => modelInfo[model.id].family.includes('bert') === true)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }

}

export const loadMistralAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  // load
  let models: Model[] = []
  try {
    const mistralai = new MistralAI(engineConfig)
    models = await mistralai.getModels()
  } catch (error) {
    console.error('Error listing MistralAI models:', error);
  }
  if (!models.length) {
    return null
  }

  // done
  return {
    chat: models
    .sort((a, b) => a.name.localeCompare(b.name))
  }

}

export const loadAnthropicModels = async (engineConfig: EngineCreateOpts, computerInfo: AnthropicComputerToolInfo|null = null): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const anthropic = new Anthropic(engineConfig, computerInfo)
    models = await anthropic.getModels()
  } catch (error) {
    console.error('Error listing Anthropic models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

}

export const loadGoogleModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const google = new Google(engineConfig)
    models = await google.getModels()
  } catch (error) {
    console.error('Error listing Google models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

}

export const loadGroqModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const groq = new Groq(engineConfig)
    models = await groq.getModels()
  } catch (error) {
    console.error('Error listing Groq models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

}

export const loadCerebrasModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const cerebras = new Cerebreas(engineConfig)
    models = await cerebras.getModels()
  } catch (error) {
    console.error('Error listing Cerebras models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

}

export const loadXAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const xai = new XAI(engineConfig)
    models = await xai.getModels()
  } catch (error) {
    console.error('Error listing xAI models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

}
