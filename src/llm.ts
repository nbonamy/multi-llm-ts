
import { anyDict, Model, EngineConfig } from 'types/index.d'
import LlmEngine from 'engine'
import Anthropic, { AnthropicComputerToolInfo } from './providers/anthropic'
import Cerebreas from './providers/cerebras'
import Google from './providers/google'
import Groq from './providers/groq'
import MistralAI from './providers/mistralai'
import Ollama from './providers/ollama'
import OpenAI from './providers/openai'
import XAI from './providers/xai'

export const igniteEngine = (engine: string, config: EngineConfig): LlmEngine => {
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

export const loadModels = async (engine: string, config: EngineConfig): Promise<boolean> => {
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

export const hasVisionModels = (engine: string, config: EngineConfig) => {
  const instance = igniteEngine(engine, config)
  return instance.getVisionModels().length > 0
}

export const isVisionModel = (engine: string, model: string, config: EngineConfig) => {
  const instance = igniteEngine(engine, config)
  return instance.isVisionModel(model)
}

const getValidModelId = (engineConfig: EngineConfig, type: string, modelId: string) => {
  const models: Model[] = engineConfig?.models?.[type as keyof typeof engineConfig.models]
  const m = models?.find(m => m.id == modelId)
  return m ? modelId : (models?.[0]?.id || null)
}

export const loadOpenAIModels = async (engineConfig: EngineConfig) => {

  // load
  let models = null
  try {
    const openAI = new OpenAI(engineConfig)
    models = await openAI.getModels()
  } catch (error) {
    console.error('Error listing OpenAI models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // xform
  models = models
    .map(model => { return {
      id: model.id,
      name: model.id,
      meta: model
    }})
    .sort((a, b) => a.name.localeCompare(b.name))

  // store
  engineConfig.models = {
    chat: models.filter(model => model.id.startsWith('gpt-') || model.id.startsWith('o1-')),
    image: models.filter(model => model.id.startsWith('dall-e-'))
  }

  // select valid model
  engineConfig.model = {
    chat: getValidModelId(engineConfig, 'chat', engineConfig.model?.chat),
    image: getValidModelId(engineConfig, 'image', engineConfig.model?.image)
  }

  // done
  return true

}

export const loadOllamaModels = async (engineConfig: EngineConfig) => {

  // needed
  const ollama = new Ollama(engineConfig)

  // load
  let models: any[] = null
  try {
    models = await ollama.getModels()
  } catch (error) {
    console.error('Error listing Ollama models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // get info
  const modelInfo: anyDict = {}
  for (const model of models) {
    const info = await ollama.getModelInfo(model.model)
    modelInfo[model.model] = {
      ...info.details,
      ...info.model_info,
    }
  }

  // needed
  const ollamaModelMapper = (model: any) => {
    return {
      id: model.model,
      name: model.name,
      meta: model
    }
  }

  // store
  engineConfig.models = {
    chat: models
      .filter(model => modelInfo[model.model].family.includes('bert') === false)
      .map(ollamaModelMapper)
      .sort((a, b) => a.name.localeCompare(b.name)),
    embedding: models
      .filter(model => modelInfo[model.model].family.includes('bert') === true)
      .map(ollamaModelMapper)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true

}

export const loadMistralAIModels = async (engineConfig: EngineConfig) => {

  // load
  let models: any[] = null
  try {
    const mistralai = new MistralAI(engineConfig)
    models = await mistralai.getModels()
  } catch (error) {
    console.error('Error listing MistralAI models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.id,
      meta: model
    }})
    .sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true

}

export const loadAnthropicModels = async (engineConfig: EngineConfig, computerInfo: AnthropicComputerToolInfo = null) => {
  
  let models = []

  try {
    const anthropic = new Anthropic(engineConfig, computerInfo)
    models = await anthropic.getModels()
  } catch (error) {
    console.error('Error listing Anthropic models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.name,
      meta: model
    }})
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true
}

export const loadGoogleModels = async (engineConfig: EngineConfig) => {
  
  let models = []

  try {
    const google = new Google(engineConfig)
    models = await google.getModels()
  } catch (error) {
    console.error('Error listing Google models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.name,
      meta: model
    }})
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true
}

export const loadGroqModels = async (engineConfig: EngineConfig) => {
  
  let models = []

  try {
    const groq = new Groq(engineConfig)
    models = await groq.getModels()
  } catch (error) {
    console.error('Error listing Groq models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.name,
      meta: model
    }})
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true
}

export const loadCerebrasModels = async (engineConfig: EngineConfig) => {
  
  let models = []

  try {
    const cerebras = new Cerebreas(engineConfig)
    models = await cerebras.getModels()
  } catch (error) {
    console.error('Error listing Cerebras models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.name,
      meta: model
    }})
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true
}

export const loadXAIModels = async (engineConfig: EngineConfig) => {
  
  let models = []

  try {
    const xai = new XAI(engineConfig)
    models = await xai.getModels()
  } catch (error) {
    console.error('Error listing xAI models:', error);
  }
  if (!models) {
    engineConfig.models = { chat: [], image: [], }
    return false
  }

  // store
  engineConfig.models = {
    chat: models
    .map(model => { return {
      id: model.id,
      name: model.name,
      meta: model
    }})
    //.sort((a, b) => a.name.localeCompare(b.name))
  }

  // select valid model
  engineConfig.model.chat = getValidModelId(engineConfig, 'chat', engineConfig.model.chat)

  // done
  return true
}
