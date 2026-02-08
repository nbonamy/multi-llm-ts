
import { ZodType } from 'zod'
import { ChatModel } from './index'
import { PluginExecutionContext, PluginTool } from './plugin'

export type LlmRole = 'system'|'developer'|'user'|'assistant'

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
  thoughtSignature?: string
  openAIResponseId?: string
  usage?: LlmUsage
}

export type LlmToolCall = {
  id: string
  function: string
  args: any
  message?: any
  result?: any
  thoughtSignature?: string
  reasoningDetails?: any
}

export type NormalizedToolChunk = {
  type: 'start' | 'delta'

  // For 'start': create new tool call
  id?: string           // tool call ID
  name?: string         // function name
  args?: string         // initial args ('' for incremental, complete JSON for Google)
  message?: any         // Native message format for thread formatting (provider-specific)

  // For 'delta': append to current tool call
  argumentsDelta?: string

  // Common metadata
  metadata?: {
    index?: number              // Anthropic block tracking
    thoughtSignature?: string   // Google
    reasoningDetails?: any      // OpenAI
  }
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

//
// Streaming context
//

export type ToolHistoryEntry = {
  id: string
  name: string
  args: any
  result: any
  round: number
}

// Base streaming context - all providers have a thread
export type LlmStreamingContext<T = any> = {
  model: ChatModel
  opts: LlmCompletionOpts
  usage: LlmUsage
  thread: T[]
  toolCalls: LlmToolCall[]  // current round's tool calls (reset each round)
  toolHistory: ToolHistoryEntry[]  // all tool calls across all rounds
  currentRound: number
  startTime: number  // when the current LLM request started (for cooldown)
}

// Completed tool call info for batched execution
export type CompletedToolCall = {
  tc: LlmToolCall
  args: any
  result: any
}

export type LlmStreamingResponse<T extends LlmStreamingContext = LlmStreamingContext> = {
  stream: LlmStream
  context: T
}

//
// Engine hooks
//

export type EngineHookName = 'beforeToolCallsResponse'

export type EngineHookPayloads = {
  beforeToolCallsResponse: LlmStreamingContext
}

export type EngineHookCallback<T extends EngineHookName> = (payload: EngineHookPayloads[T]) => void | Promise<void>

export type LlmReasoningEffort = 'low'|'medium'|'high'

export type LlmVerbosity = 'low'|'medium'|'high'

export type LLmCustomModelOpts = Record<string, any>

export type LlmOpenAIServiceTier = 'auto' | 'default' | 'flex' | 'scale' | 'priority' | null

export type LlmOpenAIModelOpts = {
  useResponsesApi?: boolean
  responseId?: string
  reasoningEffort?: LlmReasoningEffort
  verbosity?: LlmVerbosity
  serviceTier?: LlmOpenAIServiceTier
}

export type LlmAnthropicModelOpts = {
  reasoning?: boolean
  reasoningBudget?: number
}

export type LlmGoogleModelOpts = {
  thinkingBudget?: number
}

export type LlmOllamaThink = boolean | 'high' | 'medium' | 'low'

export type LlmOllamaModelOpts = {
  think?: LlmOllamaThink
}

export type LlmModelOpts = {
  timeout?: number
  contextWindowSize?: number
  maxTokens?: number
  temperature?: number
  top_k?: number
  top_p?: number
  customOpts?: LLmCustomModelOpts
} & LlmOpenAIModelOpts & LlmAnthropicModelOpts & LlmGoogleModelOpts & LlmOllamaModelOpts

export type LlmStructuredOutput = {
  name: string
  structure: ZodType
}

export type LlmToolExecutionValidationDecision = 'allow'|'deny'|'abort'

export type LlmToolExecutionValidationResponse = {
  decision: LlmToolExecutionValidationDecision
  extra?: any
}

export type LlmToolExecutionValidationCallback = (context: PluginExecutionContext, tool: string, args: any) => Promise<LlmToolExecutionValidationResponse>

export type LlmCompletionOpts = {
  tools?: boolean
  toolChoice?: LlmToolChoice
  toolExecutionValidation?: LlmToolExecutionValidationCallback
  toolCallsInThread?: boolean
  caching?: boolean
  visionFallbackModel?: ChatModel
  usage?: boolean
  citations?: boolean
  structuredOutput?: LlmStructuredOutput

  // this is provided by the caller
  // to cancel the request if needed
  abortSignal?: AbortSignal

} & LlmModelOpts

export type LlmCompletionPayloadContent = {
  role: LlmRole
  content: string|LlmContentPayload[]
  images?: string[]
  tool_calls?: any[]
}

export type LlmCompletionPayloadTool = {
  role: 'tool'
  tool_call_id: string
  name: string
  content: string
}

export type LlmCompletionPayload = LlmCompletionPayloadContent | LlmCompletionPayloadTool

export type LLmContentPayloadText = {
  type: 'text'
  text: string
  thoughtSignature?: string
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

export type LlmContentPayloadMistralai ={
  type: 'image_url'
  imageUrl: {
    url: string
  }
}

export type LlmContentPayload =
  LLmContentPayloadText |
  LLmContentPayloadImageOpenai |
  LLmContentPayloadDocumentAnthropic |
  LLmContentPayloadImageAnthropic |
  LlmContentPayloadMistralai

export type LlmChunkToolAbort = {
  type: 'tool_abort'
  name: string
  params: any
  reason: LlmToolExecutionValidationResponse
}

export type LlmChunkContent = {
  type: 'content'|'reasoning'
  text: string
  thoughtSignature?: string
  done: boolean
}

export type LlmChunkStream ={
  type: 'stream'
  stream: LlmStream
}

export type ToolExecutionState = 'preparing' | 'running' | 'completed' | 'canceled' | 'error'

export type LlmChunkTool = {
  type: 'tool'
  id: string
  name: string
  state: ToolExecutionState
  status?: string
  call?: {
    params: any
    result: any
  }
  thoughtSignature?: string
  reasoningDetails?: any
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

export type LlmChunk = LlmChunkToolAbort | LlmChunkContent | LlmChunkStream | LlmChunkTool | LlmChunkUsage | LlmOpenAIMessageId

export type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array'

export type LlmToolArrayItem = {
  name: string
  type: ToolParameterType
  description: string
  required?: boolean
}

export type LlmToolArrayItems = {
  type: string
  required?: boolean
  properties?: LlmToolArrayItem[]
}

export type LlmToolParameterOpenAI = {
  type: ToolParameterType
  description: string
  enum?: string[]
  items?: LlmToolArrayItems
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

/**
 * LlmTool accepts both the new PluginTool format and legacy OpenAI format.
 * Prefer using PluginTool for new code.
 */
export type LlmTool = PluginTool | LlmToolOpenAI

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
