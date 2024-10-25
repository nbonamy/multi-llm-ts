

export type LlmRole = 'system'|'user'|'assistant'

interface LlmResponse {
  type: string
  content?: string
  original_prompt?: string
  revised_prompt?: string
  url?: string
}

type LlmStream = AsyncGenerator|Stream

interface LlmCompletionOpts {
  save?: boolean
  titling?: boolean
  engine?: string
  model?: string
  overwriteEngineModel?: boolean
  systemInstructions?: string
  attachment?: Attachment
  docrepo?: string
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792' | null
  style?: 'vivid' | 'natural' | null
  //maxTokens?: number
  n?: number
}

interface LLmCompletionPayload {
  role: llmRole
  content?: sring|LlmContentPayload[]
  images?: string[]
  tool_call_id?: string
  name?: string
}

interface LlmContentPayload {
  type: string
  text?: string
  // openai
  image_url?: {
    url: string
  }
  // anthropic
  source?: {
    type: string
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

interface LlmChunk {
  text: string
  done: boolean
}

export interface LlmToolParameterOpenAI {
  name: string
  description: string
  type: string
  enum?: string[]
  required?: boolean
}

interface LlmToolOpenAI {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: { [key: string]: LlmToolParameterOpenAI }
      required: string[]
    }
  }
}

export type LlmTool = LlmToolOpenAI

interface LlmToolCall {
  id: string
  message: any
  function: string
  args: string
}

interface LlmEvent {
  type: 'stream' | 'tool'
  content: any
}

type LlmEventCallback = (event: LlmEvent) => void
