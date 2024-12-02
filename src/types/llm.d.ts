
import { Model } from './index.d'

export type LlmRole = 'system'|'user'|'assistant'|'tool'

export type LlmResponse = {
  type: 'text'|'image'
  content?: string
  original_prompt?: string
  revised_prompt?: string
  usage?: LlmUsage
  url?: string
}

export type LlmStream = AsyncIterable<any>

export type LlmCompletionOpts = {
  models?: Model[]
  autoSwitchVision?: boolean
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792' | null
  style?: 'vivid' | 'natural' | null
  maxTokens?: number
  usage?: boolean
  n?: number
}

export type LLmCompletionPayload = {
  role: LlmRole
  content?: string|LlmContentPayload[]
  images?: string[]
  tool_call_id?: string
  tool_calls?: any[]
  name?: string
}

export type LLmContentPayloadText = {
  type: 'text'
  text: string
}

export type LLmContentPayloadImageOpenai ={
  type: 'image_url'
  image_url: {
    url: string
  }
}

export type LLmContentPayloadImageAnthropic = {
  type: 'image'
  source?: {
    type: string
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

export type LlmContentPayload = LLmContentPayloadText | LLmContentPayloadImageOpenai | LLmContentPayloadImageAnthropic

export type LlmChunkContent = {
  type: 'content'
  text: string
  done: boolean
}

export type LlmChunkStream ={
  type: 'stream'
  stream: LlmStream
}

export type LlmChunkTool = {
  type: 'tool'
  name: string
  status?: string
  call?: {
    params: any
    result: any
  }
  done: boolean
}

export type LlmChunkUsage = {
  type: 'usage'
  usage: LlmUsage
}

export type LlmChunk = LlmChunkContent | LlmChunkStream | LlmChunkTool | LlmChunkUsage

export type LlmToolParameterOpenAI = {
  name: string
  description: string
  type: string
  enum?: string[]
  required?: boolean
}

export type LlmToolOpenAI = {
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

export type LlmToolCall = {
  id: string
  message: any
  function: string
  args: string
}

export type LlmUsage = {
  prompt_tokens: number
  completion_tokens: number
  prompt_tokens_details?: {
    cached_tokens?: number
    audio_tokens?: number
  }
  completion_tokens_details?: {
    reasoning_tokens?: number
    audio_tokens?: number
  }
}
