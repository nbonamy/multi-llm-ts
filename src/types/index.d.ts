

export type anyDict = {[key: string]: any}
export type strDict = {[key: string]: string}

interface Message {
  uuid: string
  createdAt: number
  role: llmRole
  type: string
  content: string
  attachment: Attachment
  transient: boolean
  fromJson(json: any): void
  setText(text: string|null): void
  setImage(url: string): void
  appendText(chunk: LlmChunk): void
  attachFile(file: Attachment): void
  setToolCall(toolCall: string|null): void
}

interface Attachment {
  url: string
  mimeType: string
  contents: string
  downloaded: boolean
  fromJson(json: any): void
  format(): string
  isText(): boolean
  isImage(): boolean
}

interface EngineConfig {
  apiKey?: string
  baseURL?: string
  models?: ModelsConfig
  model?: ModelConfig
}

interface ModelsConfig {
  chat: Model[]
  image?: Model[]
  embedding?: Model[]
}

interface Model {
  id: string
  name: string
  meta: any
}
