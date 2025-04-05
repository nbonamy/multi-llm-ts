
import { EngineCreateOpts, Model, ModelsList } from 'types/index'
import LlmEngine from 'engine'
import Anthropic, { AnthropicComputerToolInfo } from './providers/anthropic'
import Cerebreas from './providers/cerebras'
import DeepSeek from './providers/deepseek'
import Google from './providers/google'
import Groq from './providers/groq'
import MistralAI from './providers/mistralai'
import Ollama from './providers/ollama'
import OpenAI from './providers/openai'
import OpenRouter from './providers/openrouter'
import XAI from './providers/xai'

export const staticModelsListEngines = [ ]

export const igniteEngine = (engine: string, config: EngineCreateOpts): LlmEngine => {
  if (engine === 'anthropic') return new Anthropic(config)
  if (engine === 'cerebras') return new Cerebreas(config)
  if (engine === 'deepseek') return new DeepSeek(config)
  if (engine === 'google') return new Google(config)
  if (engine === 'groq') return new Groq(config)
  if (engine === 'mistralai') return new MistralAI(config)
  if (engine === 'ollama') return new Ollama(config)
  if (engine === 'openai') return new OpenAI(config)
  if (engine === 'openrouter') return new OpenRouter(config)
  if (engine === 'xai') return new XAI(config)
  throw new Error('Unknown engine: ' + engine)
}

export const loadModels = async (engine: string, config: EngineCreateOpts): Promise<ModelsList|null> => {
  if (engine === 'anthropic') return await loadAnthropicModels(config)
  if (engine === 'cerebras') return await loadCerebrasModels(config)
  if (engine === 'deepseek') return await loadDeepSeekModels(config)
  if (engine === 'google') return await loadGoogleModels(config)
  if (engine === 'groq') return await loadGroqModels(config)
  if (engine === 'mistralai') return await loadMistralAIModels(config)
  if (engine === 'ollama') return await loadOllamaModels(config)
  if (engine === 'openai') return await loadOpenAIModels(config)
  if (engine === 'openrouter') return await loadOpenRouterModels(config)
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

  // depends on the provider
  if (!engineConfig.baseURL || engineConfig.baseURL.includes('api.openai.com')) {

    // // debug
    // for (const model of models) {
    //   console.log(model.id)
    // }

    // filter out some models
    models = models.filter(model =>
      !model.id.includes('davinci') &&
      !model.id.includes('babbage') &&
      !model.id.includes('moderation') &&
      !model.id.includes('audio') &&
      !model.id.includes('search')
    )

    // assign models
    const imageModels = models.filter(model => model.id.startsWith('dall-e-'))
    const embeddingModels = models.filter(model => model.id.startsWith('text-embedding-'))
    const realtimeModels = models.filter(model => model.id.includes('realtime'))
    const computerModels = models.filter(model => model.id.includes('computer-use'))
    const sttModels = models.filter(model => model.id.includes('whisper') || model.id.includes('transcribe'))
    const ttsModels = models.filter(model => model.id.includes('tts'))

    // chat models are the rest
    const chatModels = models.filter(model => 
      !imageModels.includes(model) &&
      !embeddingModels.includes(model) &&
      !realtimeModels.includes(model) &&
      !computerModels.includes(model) &&
      !sttModels.includes(model) &&
      !ttsModels.includes(model)
    )

    return {
      chat: chatModels,
      image: imageModels,
      embedding: embeddingModels,
      realtime: realtimeModels,
      computer: computerModels,
      stt: sttModels,
      tts: ttsModels,
    }

  } else if (engineConfig.baseURL.includes('api.together.xyz')) {
  
    // debug
    // for (const model of models) {
    //   console.log(`[${model.meta?.type}] ${model.id}`)
    // }

    return {
      chat: models.filter(model => ['language', 'chat', 'code'].includes(model.meta?.type)),
      image: models.filter(model => model.meta?.type === 'image'),
      embedding: models.filter(model => model.meta?.type === 'embedding')
    }

  } else {

    return {
      chat: models,
      image: [],
      embedding: []
    }

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
    image: [],
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
    chat: models.sort((a, b) => a.name.localeCompare(b.name)),
    image: [],
    embedding: []
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
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name)),
    image: [],
    embedding: []
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
    chat: models.filter((m) => m.meta?.supportedGenerationMethods?.includes('generateContent')),
    image: models.filter((m) => m.meta?.supportedGenerationMethods?.includes('bidiGenerateContent')),
    embedding: models.filter((m) => m.meta?.supportedGenerationMethods?.includes('embedContent')),
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

  // specialized models
  const ttsModels = models.filter(model => model.id.includes('tts'))

  // chat models are the rest
  const chatModels = models.filter(model => 
    !ttsModels.includes(model)
  )

  // done
  return {
    chat: chatModels,//.sort((a, b) => a.name.localeCompare(b.name))
    image: [],
    embedding: [],
    realtime: [],
    computer: [],
    stt: [],
    tts: ttsModels,
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
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name))
    image: [],
    embedding: []
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
    chat: models.filter((m) => !m.id.includes('image')),
    image: models.filter((m) => m.id.includes('image')),
    embedding: []
  }

}

export const loadDeepSeekModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const deepseek = new DeepSeek(engineConfig)
    models = await deepseek.getModels()
  } catch (error) {
    console.error('Error listing DeepSeek models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name))
    image: [],
    embedding: []
  }

}


export const loadOpenRouterModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  let models: Model[] = []

  try {
    const openrouter = new OpenRouter(engineConfig)
    models = await openrouter.getModels()
  } catch (error) {
    console.error('Error listing OpenRouter models:', error);
  }
  if (!models) {
    return null
  }

  // done
  return {
    chat: models.filter((m) => m.meta?.architecture?.modality.split('>').pop().includes('text')).sort((a, b) => a.name.localeCompare(b.name)),
    image: models.filter((m) => m.meta?.architecture?.modality.split('>').pop().includes('image')).sort((a, b) => a.name.localeCompare(b.name)),
    embedding: []
  }

}
