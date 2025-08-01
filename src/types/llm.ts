
import { ZodType } from 'zod'
import { ChatModel } from './index'

export type LlmRole = 'system'|'developer'|'user'|'assistant'|'tool'

export type LlmToolChoiceAuto = { type: 'auto' }
export type LlmToolChoiceNone = { type: 'none' }
export type LlmToolChoiceRequired = { type: 'required' }
export type LlmToolChoiceNamed = {
  type: 'tool'
  name: string
}

export type LlmToolChoice = LlmToolChoiceNone | LlmToolChoiceAuto | LlmToolChoiceRequired | LlmToolChoiceNamed

export type LlmToolCallInfo = {
  name: string
  params: any
  result: any
}

export type LlmResponse = {
  type: 'text'
  content?: string
  toolCalls?: LlmToolCallInfo[]
  openAIResponseId?: string
  usage?: LlmUsage
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

export type LlmStream = AsyncIterable<any> & {

  // this is the abort controller returned by the provider
  // we use this to cancel the streaming on the provider side
  controller?: AbortController;

}

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
  tools?: boolean
  toolChoice?: LlmToolChoice
  caching?: boolean
  visionFallbackModel?: ChatModel
  usage?: boolean
  citations?: boolean
  useOpenAIResponsesApi?: boolean
  openAIResponseId?: string
  structuredOutput?: {
    name: string
    structure: ZodType
  }

  // this is provided by the caller
  // to cancel the request if needed
  abortSignal?: AbortSignal

} & LlmModelOpts

export type LLmCompletionPayload = {
  role: LlmRole
  content: string|LlmContentPayload[]
  images?: string[]
  tool_call_id?: string
  tool_calls?: any[]
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
  id: string
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

export type LlmOpenAIMessageId = {
  type: 'openai_message_id'
  id: string
}

export type LlmChunk = LlmChunkContent | LlmChunkStream | LlmChunkTool | LlmChunkUsage | LlmOpenAIMessageId

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
      properties: Record<string, LlmToolParameterOpenAI>
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
