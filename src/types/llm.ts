
import { Model } from './index'

export type LlmRole = 'system'|'developer'|'user'|'assistant'|'tool'

export type LlmToolCallInfo = {
  name: string
  params: any
  result: any
}

export type LlmResponse = {
  type: 'text'|'image'
  content?: string
  toolCalls: LlmToolCallInfo[]
  original_prompt?: string
  revised_prompt?: string
  usage?: LlmUsage
  url?: string
}

export type LlmToolCall = {
  id: string
  message: any
  function: string
  args: string
}

export type LlmToolResponse = {
  type: 'tools'
  calls: LlmToolCall[]
}

export type LlmNonStreamingResponse = LlmResponse | LlmToolResponse

export type LlmStream = AsyncIterable<any>

export type LlmStreamingContext = any

export type LlmStreamingResponse = {
  stream: LlmStream
  context: LlmStreamingContext
}

export type LlmReasoningEffort = 'low'|'medium'|'high'

export type LLmCustomModelOpts = Record<string, any>

export type LlmOpenAIModelOpts = {
  reasoningEffort?: LlmReasoningEffort
}

export type LlmAnthropicModelOpts = {
  reasoning?: boolean
  reasoningBudget?: number
}

export type LlmModelOpts = {
  contextWindowSize?: number
  maxTokens?: number
  temperature?: number
  top_k?: number
  top_p?: number
  customOpts?: LLmCustomModelOpts
} & LlmOpenAIModelOpts & LlmAnthropicModelOpts

export type LlmCompletionOpts = {
  models?: Model[]
  tools?: boolean
  autoSwitchVision?: boolean
  usage?: boolean
  citations?: boolean
} & LlmModelOpts

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

export type LLmContentPayloadDocumentAnthropic = {
  type: 'document'
  source?: {
    type: 'text'
    media_type: 'text/plain'
    data: string
  },
  title?: string,
  context?: string
  citations?: {
    enabled: boolean
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

export type LlmContentPayload =
  LLmContentPayloadText |
  LLmContentPayloadImageOpenai |
  LLmContentPayloadDocumentAnthropic |
  LLmContentPayloadImageAnthropic

export type LlmChunkContent = {
  type: 'content'|'reasoning'
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

export type LlmToolArrayItem = {
  name: string
  type: string
  description: string
  required?: boolean
}

export type LlmToolArrayItems = {
  type: string
  properties?: LlmToolArrayItem[]
}

export type LlmToolParameterOpenAI = {
  name: string
  type: string
  description: string
  enum?: string[]
  items?: LlmToolArrayItems
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
