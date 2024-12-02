
export type EngineCreateOpts = {
  apiKey?: string
  baseURL?: string
}

export type ModelsList = {
  chat: Model[]
  image?: Model[]
  embedding?: Model[]
}

export type Model = {
  id: string
  name: string
  meta?: any
}
