
export type EngineCreateOpts = {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
}

export type ModelsList = {
  chat: Model[]
  image?: Model[]
  video?: Model[]
  embedding?: Model[]
  realtime?: Model[]
  computer?: Model[]
  tts?: Model[]
  stt?: Model[]
}

export type Model = {
  id: string
  name: string
  meta?: any
}
