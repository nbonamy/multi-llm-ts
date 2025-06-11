export type EngineCreateOpts = {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  deployment?: string
  apiVersion?: string
}

export type ModelsList = {
  chat: ChatModel[]
  image?: Model[]
  video?: Model[]
  embedding?: Model[]
  realtime?: Model[]
  computer?: Model[]
  tts?: Model[]
  stt?: Model[]
}

export type ModelCapabilities = {
  tools: undefined|boolean
  vision: boolean
  reasoning: boolean
}

export type Model = {
  id: string
  name: string
  meta?: ModelMetadata
}

export type ChatModel = Model & {
  capabilities: ModelCapabilities
}

export type ModelGeneric = {
  id: string
  name: string
}

export type ModelAnthropic = {
  type: string
  id: string
  display_name: string
  created_at: string
}

export type ModelCerebras = {
  id: string
  object: string
  created: number
  owned_by: string
}

export type ModelDeepseek = {
  id: string
  object: string
  owned_by: string
}

export type ModelGoogle = {
  name: string
  version: string
  displayName: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  supportedGenerationMethods: string[]
  temperature: number
  topP: number
  topK: number
  maxTemperature: number
}

export type ModelGroq = {
  id: string
  object: string
  created: number
  owned_by: string
  active?: boolean
  context_window?: number
  public_apps?: any
  max_completion_tokens?: number
}

export type ModelMeta = {
  id: string
  created: number
  object: string
  owned_by: string
}

export type ModelMistralAI = {
  id: string
  object?: string
  created?: number
  ownedBy?: string
  name?: string|null
  description?: string|null
  maxContextLength?: number
  aliases?: string[]
  deprecation?: any
  capabilities: {
    completionChat?: boolean
    completionFim?: boolean
    functionCalling?: boolean
    fineTuning?: boolean
    vision?: boolean
  }
  type?: string
}

export type ModelOllama = {
  name: string
  model: string
  modified_at: Date
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export type ModelOpenAI = {
  id: string
  object: string
  created: number
  owned_by: string
}

export type ModelOpenRouter = {
  id: string
  hugging_face_id: string | null
  name: string
  created: number
  description: string
  context_length: number
  architecture: {
    modality: string
    input_modalities: string[]
    output_modalities: string[]
    tokenizer: string
    instruct_type: string | null
  }
  pricing: {
    prompt: string
    completion: string
    request: string
    image: string
    web_search: string
    internal_reasoning: string
  }
  top_provider: {
    context_length: number
    max_completion_tokens: number
    is_moderated: boolean
  }
  per_request_limits: any
  supported_parameters: string[]
}

export type ModelTogether = {
  id: string
  object: string
  created: number
  type: string
  running: boolean
  display_name: string
  organization: string
  link: string
  context_length: number
  config: {
    chat_template: string
    stop: string[]
    bos_token: string
    eos_token: string
  }
  pricing: {
    hourly: number
    input: number
    output: number
    base: number
    finetune: number
  }
}

export type ModelxAI = {
  id: string
  created: number
  object: string
  owned_by: string
}

export type ModelLMStudio = {
  id: string
  name: string
  path?: string
  size?: number
  family?: string
  parameters?: string
  quantization?: string
  format?: string
}

export type ModelMetadata =  ModelGeneric |
  ModelAnthropic | ModelCerebras | ModelDeepseek | ModelGoogle |
  ModelGroq | ModelLMStudio | ModelMeta | ModelMistralAI | ModelOllama | ModelOpenAI |
  ModelOpenRouter | ModelTogether | ModelxAI| ModelLMStudio
