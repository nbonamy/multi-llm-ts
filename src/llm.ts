
import { ChatModel, EngineCreateOpts, ModelAnthropic, ModelCerebras, ModelDeepseek, ModelGoogle, ModelGroq, ModelMeta, ModelMistralAI, ModelOllama, ModelOpenAI, ModelOpenRouter, ModelsList, ModelTogether, ModelxAI } from './types/index'
import LlmEngine from 'engine'
import Anthropic, { AnthropicComputerToolInfo } from './providers/anthropic'
import Azure from './providers/azure'
import Cerebreas from './providers/cerebras'
import DeepSeek from './providers/deepseek'
import Google from './providers/google'
import Groq from './providers/groq'
import Meta from './providers/meta'
import MistralAI from './providers/mistralai'
import Ollama from './providers/ollama'
import OpenAI from './providers/openai'
import OpenRouter from './providers/openrouter'
import XAI from './providers/xai'

export const staticModelsListEngines = [ ]

export const igniteEngine = (engine: string, config: EngineCreateOpts): LlmEngine => {
  if (engine === 'azure') return new Azure(config)
  if (engine === 'anthropic') return new Anthropic(config)
  if (engine === 'cerebras') return new Cerebreas(config)
  if (engine === 'deepseek') return new DeepSeek(config)
  if (engine === 'google') return new Google(config)
  if (engine === 'groq') return new Groq(config)
  if (engine === 'meta') return new Meta(config)
  if (engine === 'mistralai') return new MistralAI(config)
  if (engine === 'ollama') return new Ollama(config)
  if (engine === 'openai') return new OpenAI(config)
  if (engine === 'openrouter') return new OpenRouter(config)
  if (engine === 'xai') return new XAI(config)
  throw new Error('Unknown engine: ' + engine)
}

export const loadModels = async (engine: string, config: EngineCreateOpts): Promise<ModelsList|null> => {
  if (engine === 'azure') return await loadAzureModels(config)
  if (engine === 'anthropic') return await loadAnthropicModels(config)
  if (engine === 'cerebras') return await loadCerebrasModels(config)
  if (engine === 'deepseek') return await loadDeepSeekModels(config)
  if (engine === 'google') return await loadGoogleModels(config)
  if (engine === 'groq') return await loadGroqModels(config)
  if (engine === 'meta') return await loadMetaModels(config)
  if (engine === 'mistralai') return await loadMistralAIModels(config)
  if (engine === 'ollama') return await loadOllamaModels(config)
  if (engine === 'openai') return await loadOpenAIModels(config)
  if (engine === 'openrouter') return await loadOpenRouterModels(config)
  if (engine === 'xai') return await loadXAIModels(config)
  throw new Error('Unknown engine: ' + engine)
}

export const loadAnthropicModels = async (engineConfig: EngineCreateOpts, computerInfo: AnthropicComputerToolInfo|null = null): Promise<ModelsList|null> => {
  
  const anthropic = new Anthropic(engineConfig, computerInfo)
  let metas: ModelAnthropic[] = []

  try {
    metas = await anthropic.getModels()
  } catch (error) {
    console.error('Error listing Anthropic models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.display_name,
    capabilities: anthropic.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created_at.localeCompare(a.meta.created_at))

  // done
  return {
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name)),
    image: [],
    embedding: []
  }

}

export const loadAzureModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  const azure = new Azure(engineConfig)
  let metas: ModelOpenAI[] = []

  // load
  try {
    metas = await azure.getModels()
  } catch (error) {
    console.error('Error listing Azure models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id,
    capabilities: azure.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => a.name.localeCompare(b.name))

  // // debug
  // for (const model of models) {
  //   console.log(model.id)
  // }

  return {
    chat: models,
    image: [],
  }

}

export const loadCerebrasModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const cerebras = new Cerebreas(engineConfig)
  let metas: ModelCerebras[] = []

  try {
    metas = await cerebras.getModels()
  } catch (error) {
    console.error('Error listing Cerebras models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    capabilities: cerebras.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created - a.meta.created)

  // done
  return {
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name))
    image: [],
    embedding: []
  }

}

export const loadDeepSeekModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const deepseek = new DeepSeek(engineConfig)
  let metas: ModelDeepseek[] = []

  try {
    metas = await deepseek.getModels()
  } catch (error) {
    console.error('Error listing DeepSeek models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id.split('-').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ').replace('Deepseek', 'DeepSeek'),
    capabilities: deepseek.getModelCapabilities(m),
    meta: m,
  }))

  // done
  return {
    chat: models,//.sort((a, b) => a.name.localeCompare(b.name))
    image: [],
    embedding: []
  }

}

export const loadGoogleModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const google = new Google(engineConfig)
  let metas: ModelGoogle[] = []

  try {
    metas = await google.getModels()
  } catch (error) {
    console.error('Error listing Google models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.name.replace('models/', ''),
    name: m.displayName,
    capabilities: google.getModelCapabilities(m),
    meta: m,
  })).filter(m => !m.id.includes('generation')) // remove generation models

  const imageModels = models.filter((m) => (m.meta as ModelGoogle).supportedGenerationMethods?.includes('bidiGenerateContent'))
  const embeddingModels = models.filter((m) => (m.meta as ModelGoogle).supportedGenerationMethods?.includes('embedContent'))
  const ttsModels = models.filter(model => model.id.endsWith('tts'))

  const chatModels = models
    .filter((m) => (m.meta as ModelGoogle).supportedGenerationMethods?.includes('generateContent'))
    .filter(model => 
        !imageModels.includes(model) &&
        !embeddingModels.includes(model) &&
        !ttsModels.includes(model)
      )
    .sort((a, b) => {
      if (a.id.includes('gemini') && !b.id.includes('gemini')) {
        return -1
      }
      return b.name.localeCompare(a.name)
    })

  // done
  return {
    chat: chatModels,
    image: imageModels,
    embedding: embeddingModels,
    tts: ttsModels
  }

}

export const loadGroqModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  const groq = new Groq(engineConfig)
  let metas: ModelGroq[] = []

  try {
    metas = await groq.getModels()
  } catch (error) {
    console.error('Error listing Groq models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    capabilities: groq.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created - a.meta.created)

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

export const loadMetaModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const meta = new Meta(engineConfig)
  let metas: ModelMeta[] = []

  try {
    metas = await meta.getModels()
  } catch (error) {
    console.error('Error listing Meta models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id,
    capabilities: meta.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created - a.meta.created)

  // done
  return {
    chat: models,
    image: [],
    embedding: []
  }

}

export const loadMistralAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  const mistralai = new MistralAI(engineConfig)
  let metas: ModelMistralAI[] = []

  try {
    metas = await mistralai.getModels()
  } catch (error) {
    console.error('Error listing MistralAI models:', error);
  }
  if (!metas.length) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.name || m.id,
    capabilities: mistralai.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => {
    if (a.meta?.created && b.meta?.created && a.meta.created !== b.meta.created) {
      return b.meta.created - a.meta.created
    } else {
      return a.name.localeCompare(b.name)
    }
  })

  // done
  return {
    chat: models.filter(m => (m.meta as ModelMistralAI)!.capabilities?.completionChat),
    image: [],
    embedding: []
  }

}

export const loadOllamaModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  const ollama = new Ollama(engineConfig)
  let metas: ModelOllama[] = []

  // load
  try {
    metas = await ollama.getModels()
  } catch (error) {
    console.error('Error listing Ollama models:', error);
  }
  if (!metas.length) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.model,
    name: m.name,
    capabilities: ollama.getModelCapabilities(m),
    meta: m,
  }))

  // get info
  const chatModels: string[] = []
  const embeddingModels: string[] = []
  for (const model of models) {
    try {

      const info = await ollama.getModelInfo(model.id)
      if (!info) {
        chatModels.push(model.id)
        continue
      }

      let isEmbedding = info.details.family.includes('bert')

      if (info && 'capabilities' in info) {
        const capabilities: string[] = info.capabilities as string[] || []
        if (capabilities.includes('embedding')) {
          isEmbedding = true
        }
        if (capabilities.includes('tools')) {
          model.capabilities.tools = true
        }
        if (capabilities.includes('vision')) {
          model.capabilities.vision = true
        }
      }

      // add to chat models
      if (isEmbedding) {
        embeddingModels.push(model.id)
      } else {
        chatModels.push(model.id)
      }

    } catch (e) {
      console.error(`Error getting info for model ${model.id}:`, e);
    }
  }

  // done
  return {
    chat: models
      .filter(model => chatModels.includes(model.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    image: [],
    embedding: models
      .filter(model => embeddingModels.includes(model.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }

}

export const loadOpenAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {

  const openAI = new OpenAI(engineConfig)
  let metas: ModelOpenAI[] = []

  try {
    metas = await openAI.getModels() as ModelOpenAI[]
  } catch (error) {
    console.error('Error listing OpenAI models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  let models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id,
    capabilities: openAI.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created - a.meta.created)

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
    const imageModels = models.filter(model => model.id.startsWith('dall-e-') || model.id.includes('image-'))
    const embeddingModels = models.filter(model => model.id.startsWith('text-embedding-'))
    const realtimeModels = models.filter(model => model.id.includes('realtime'))
    const computerModels = models.filter(model => model.id.includes('computer-use'))
    const sttModels = models.filter(model => model.id.includes('whisper') || model.id.includes('transcribe'))
    const ttsModels = models.filter(model => model.id.includes('tts'))

    // hack: add gpt-image-1
    if (!imageModels.map(m => m.id).includes('gpt-image-1')) {
      imageModels.unshift({ id: 'gpt-image-1', name: 'GPT Image', meta: {
        id: 'gpt-image-1', object: 'model', created: 0, owned_by: 'system'
      }, capabilities: { tools: false, vision: false, reasoning: false } });
    }
    
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
      chat: models.filter(model => ['language', 'chat', 'code'].includes((model.meta as ModelTogether)?.type)),
      image: models.filter(model => (model.meta as ModelTogether)?.type === 'image'),
      embedding: models.filter(model => (model.meta as ModelTogether)?.type === 'embedding')
    }

  } else {

    return {
      chat: models,
      image: [],
      embedding: []
    }

  }

}

export const loadOpenRouterModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const openrouter = new OpenRouter(engineConfig)
  let metas: ModelOpenRouter[] = []

  try {
    metas = await openrouter.getModels()
  } catch (error) {
    console.error('Error listing OpenRouter models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.name,
    capabilities: openrouter.getModelCapabilities(m),
    meta: m,
  }))

  
  // done
  return {
    chat: models.filter((m) => (m.meta as ModelOpenRouter)?.architecture?.modality?.split('>')?.pop()?.includes('text')).sort((a, b) => a.name.localeCompare(b.name)),
    image: models.filter((m) => (m.meta as ModelOpenRouter)?.architecture?.modality?.split('>')?.pop()?.includes('image')).sort((a, b) => a.name.localeCompare(b.name)),
    embedding: []
  }

}

export const loadXAIModels = async (engineConfig: EngineCreateOpts): Promise<ModelsList|null> => {
  
  const xai = new XAI(engineConfig)
  let metas: ModelxAI[] = []

  try {
    metas = await xai.getModels()
  } catch (error) {
    console.error('Error listing xAI models:', error);
  }
  if (!metas) {
    return null
  }

  // xform
  const models: ChatModel[] = metas.map(m => ({
    id: m.id,
    name: m.id.split('-').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    capabilities: xai.getModelCapabilities(m),
    meta: m,
  })).sort((a, b) => b.meta.created - a.meta.created)
  
  // done
  return {
    chat: models.filter((m) => !m.id.includes('image')),
    image: models.filter((m) => m.id.includes('image')),
    embedding: []
  }

}
