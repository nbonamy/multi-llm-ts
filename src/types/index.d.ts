
export interface EngineCreateOpts {
  apiKey?: string
  baseURL?: string
}

export interface ModelsList {
  chat: Model[]
  image?: Model[]
  embedding?: Model[]
}

export interface Model {
  id: string
  name: string
  meta?: any
}
