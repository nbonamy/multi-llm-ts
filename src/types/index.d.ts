

export type anyDict = {[key: string]: any}
export type strDict = {[key: string]: string}

export interface EngineConfig {
  apiKey?: string
  baseURL?: string
  models?: ModelsConfig
  model?: ModelConfig
}

export interface ModelsConfig {
  chat: Model[]
  image?: Model[]
  embedding?: Model[]
}

export interface Model {
  id: string
  name: string
  meta: any
}
