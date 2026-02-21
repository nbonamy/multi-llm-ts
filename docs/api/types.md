# Types

TypeScript type definitions and interfaces.

## Core Types

### ChatModel

Model information with capabilities:

```typescript
interface ChatModel {
  id: string
  name: string
  meta?: any

  capabilities?: {
    tools: boolean
    vision: boolean
    reasoning: boolean
  }
}
```

**Fields:**
- `id`: Model identifier (e.g., `'gpt-4'`)
- `name`: Display name
- `meta`: Provider-specific metadata
- `capabilities.tools`: Supports function calling
- `capabilities.vision`: Can analyze images
- `capabilities.reasoning`: Chain-of-thought model

**Example:**
```typescript
const model: ChatModel = {
  id: 'gpt-4',
  name: 'GPT-4',
  capabilities: {
    tools: true,
    vision: true,
    reasoning: false
  }
}
```

### EngineConfig

Configuration for engine creation:

```typescript
interface EngineConfig {
  apiKey?: string
  baseURL?: string
  timeout?: number
  requestCooldown?: number
  useOpenAIResponsesApi?: boolean
  customOpts?: Record<string, any>
}
```

**Fields:**
- `apiKey`: API key for authentication
- `baseURL`: Custom API endpoint
- `timeout`: Request timeout in milliseconds
- `requestCooldown`: Minimum time in ms between API request starts during tool loops (see [Providers Guide](/guide/providers#request-cooldown))
- `useOpenAIResponsesApi`: Use OpenAI's Responses API format
- `customOpts`: Provider-specific options

**Example:**
```typescript
const config: EngineConfig = {
  apiKey: 'KEY',
  baseURL: 'https://api.custom.com',
  timeout: 30000,
  requestCooldown: 2000,
  customOpts: { num_ctx: 8192 }
}
```

### LlmCompletionOpts

Options for generation:

```typescript
interface LlmCompletionOpts {
  temperature?: number
  maxTokens?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  stop?: string[]
  schema?: ZodSchema
  abortSignal?: AbortSignal
  toolExecutionDelegate?: ToolExecutionDelegate
  toolExecutionValidation?: ValidationCallback
  useOpenAIResponsesApi?: boolean
  [key: string]: any
}
```

**Example:**
```typescript
const opts: LlmCompletionOpts = {
  temperature: 0.7,
  maxTokens: 1000,
  abortSignal: controller.signal
}
```

### LlmResponse

Response from completion:

```typescript
interface LlmResponse {
  type: 'text'
  content: string
  finishReason?: string
  usage?: {
    prompt: number
    completion: number
    total: number
  }
}
```

**Example:**
```typescript
const response: LlmResponse = {
  type: 'text',
  content: 'Generated text',
  finishReason: 'stop',
  usage: {
    prompt: 10,
    completion: 20,
    total: 30
  }
}
```

## Chunk Types

### LlmChunk

Union type for all chunks:

```typescript
type LlmChunk = LlmChunkContent | LlmChunkTool | LlmChunkToolAbort
```

### LlmChunkContent

Text content chunk:

```typescript
interface LlmChunkContent {
  type: 'content'
  text?: string
  textDelta?: string
}
```

### LlmChunkTool

Tool execution status:

```typescript
interface LlmChunkTool {
  type: 'tool'
  name: string
  status: string
  state: ToolExecutionState
  parameters?: any
  result?: any
}

type ToolExecutionState =
  | 'preparing'
  | 'running'
  | 'completed'
  | 'canceled'
  | 'error'
```

### LlmChunkToolAbort

Tool abort notification:

```typescript
interface LlmChunkToolAbort {
  type: 'tool_abort'
  reason: any
}
```

## Plugin Types

### ToolParameterType

```typescript
type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array'
```

### PluginParameter

Parameter definition:

```typescript
interface PluginParameter {
  name: string
  type: ToolParameterType
  description: string
  required?: boolean
  enum?: string[]
  items?: {
    type: string
    properties?: PluginParameter[]
  }
}
```

### PluginTool

Provider-agnostic tool definition format. This is the recommended format for defining tools in `CustomToolPlugin` and `MultiToolPlugin`:

```typescript
interface PluginTool {
  name: string
  description: string
  parameters: PluginParameter[]
}
```

### PluginExecutionContext

Execution context for plugins:

```typescript
interface PluginExecutionContext {
  modelId: string
  abortSignal?: AbortSignal
}
```

### ToolExecutionDelegate

Delegate for external tool execution (see [Tool Execution Delegate](/guide/tool-delegate)):

```typescript
type ToolExecutionDelegate = {
  getTools(): Promise<PluginTool[]> | PluginTool[]
  execute(
    context: PluginExecutionContext,
    tool: string,
    args: any
  ): Promise<any>
}
```

### ValidationCallback

Tool validation callback:

```typescript
type ValidationCallback = (
  context: PluginExecutionContext,
  tool: string,
  args: any
) => Promise<ValidationResponse>
```

### ValidationResponse

Validation result:

```typescript
interface ValidationResponse {
  decision: 'allow' | 'deny' | 'abort'
  extra?: any
}
```

## Message Types

### Attachment

File attachment:

```typescript
interface Attachment {
  url: string
  mimeType: string
  downloaded?: boolean
  content?: string
}
```

### MessageRole

Message roles:

```typescript
type MessageRole = 'system' | 'user' | 'assistant'
```

## Provider Types

### Provider IDs

```typescript
type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'azure'
  | 'cerebras'
  | 'deepseek'
  | 'groq'
  | 'meta'
  | 'mistralai'
  | 'openrouter'
  | 'xai'
```

### ModelsResponse

Response from `loadModels()`:

```typescript
interface ModelsResponse {
  chat: ChatModel[]
  image?: ChatModel[]
}
```

## Usage Examples

### Type-Safe Model

```typescript
import { ChatModel } from 'multi-llm-ts'

const model: ChatModel = {
  id: 'gpt-4',
  name: 'GPT-4',
  capabilities: {
    tools: true,
    vision: true,
    reasoning: false
  }
}
```

### Type-Safe Options

```typescript
import { LlmCompletionOpts } from 'multi-llm-ts'

const options: LlmCompletionOpts = {
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9
}
```

### Type-Safe Response

```typescript
import { LlmResponse } from 'multi-llm-ts'

const response: LlmResponse = await model.complete(messages)

// TypeScript knows response.content exists
console.log(response.content)
```

### Type-Safe Chunks

```typescript
import { LlmChunk } from 'multi-llm-ts'

const stream = model.generate(messages)

for await (const chunk of stream) {
  // TypeScript provides autocomplete
  if (chunk.type === 'content') {
    console.log(chunk.text)
  } else if (chunk.type === 'tool') {
    console.log(chunk.name, chunk.state)
  }
}
```

### Type-Safe Plugin

```typescript
import {
  Plugin,
  PluginParameter,
  PluginExecutionContext
} from 'multi-llm-ts'

class MyPlugin extends Plugin {
  getParameters(): PluginParameter[] {
    return [{
      name: 'query',
      type: 'string',
      description: 'Search query',
      required: true
    }]
  }

  async execute(
    context: PluginExecutionContext,
    parameters: any
  ): Promise<any> {
    // Implementation
  }
}
```

## Zod Integration

For structured output:

```typescript
import { z } from 'zod'

const schema = z.object({
  name: z.string(),
  age: z.number()
})

type Person = z.infer<typeof schema>

const response = await model.complete(messages, { schema })
const person: Person = JSON.parse(response.content)
```

## Next Steps

- Review [LlmModel](/api/llm-model) API
- Learn about [Message](/api/message) class
- See [Plugin](/api/plugin) implementation
