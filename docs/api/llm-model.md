# LlmModel

The main abstraction for interacting with LLM models (v4.5+).

## Overview

`LlmModel` wraps an engine and a specific model together, simplifying the API by eliminating the need to pass the model parameter to every operation.

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

const config = { apiKey: 'API_KEY' }
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

// No need to pass model to operations
await model.complete(messages)
```

## Creating an LlmModel

### igniteModel()

```typescript
function igniteModel(
  provider: string,
  model: ChatModel,
  config: EngineConfig
): LlmModel
```

**Parameters:**
- `provider`: Provider ID (`'openai'`, `'anthropic'`, etc.)
- `model`: ChatModel object from `loadModels()`
- `config`: Configuration with API key and options

**Example:**
```typescript
const model = igniteModel('anthropic', chatModel, {
  apiKey: process.env.ANTHROPIC_API_KEY
})
```

## Methods

### complete()

Generate a complete response:

```typescript
async complete(
  messages: Message[],
  opts?: LlmCompletionOpts
): Promise<LlmResponse>
```

**Parameters:**
- `messages`: Array of Message objects
- `opts`: Optional generation parameters

**Returns:** `LlmResponse` with content and metadata

**Example:**
```typescript
const response = await model.complete(messages, {
  temperature: 0.7,
  maxTokens: 1000
})

console.log(response.content)
```

See [Completion](/guide/completion) for details.

### generate()

Generate a streaming response:

```typescript
generate(
  messages: Message[],
  opts?: LlmCompletionOpts
): AsyncGenerator<LlmChunk>
```

**Parameters:**
- `messages`: Array of Message objects
- `opts`: Optional generation parameters

**Returns:** Async generator yielding `LlmChunk` objects

**Example:**
```typescript
const stream = model.generate(messages)

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    console.log(chunk.text)
  }
}
```

See [Streaming](/guide/streaming) for details.

### addPlugin()

Register a plugin for function calling:

```typescript
addPlugin(plugin: Plugin): void
```

**Parameters:**
- `plugin`: Plugin instance

**Example:**
```typescript
import { MyPlugin } from './plugins'

model.addPlugin(new MyPlugin())
```

See [Function Calling](/guide/function-calling) for details.

## Properties

### model

Get the wrapped ChatModel:

```typescript
model.model: ChatModel
```

**Example:**
```typescript
console.log(model.model.id)
console.log(model.model.capabilities)
```

## LlmCompletionOpts

Options for generation:

```typescript
interface LlmCompletionOpts {
  // Generation parameters
  temperature?: number           // 0.0 - 2.0
  maxTokens?: number             // Maximum output tokens
  topP?: number                  // 0.0 - 1.0
  frequencyPenalty?: number      // -2.0 to 2.0
  presencePenalty?: number       // -2.0 to 2.0
  stop?: string[]                // Stop sequences

  // Features
  schema?: ZodSchema             // Structured output schema
  abortSignal?: AbortSignal      // Cancellation signal
  toolExecutionValidation?: ValidationCallback
  useOpenAIResponsesApi?: boolean

  // Provider-specific
  [key: string]: any
}
```

See [Completion](/guide/completion#completion-options) for details.

## LlmResponse

Response from `complete()`:

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

**Fields:**
- `content`: Generated text
- `finishReason`: Why generation stopped (`'stop'`, `'length'`, etc.)
- `usage`: Token usage information (if available)

## LlmChunk

Chunks from `generate()`:

### Content Chunk

```typescript
interface LlmChunkContent {
  type: 'content'
  text?: string
  textDelta?: string
}
```

### Tool Chunk

```typescript
interface LlmChunkTool {
  type: 'tool'
  name: string
  status: string
  state: 'preparing' | 'running' | 'completed' | 'canceled' | 'error'
  parameters?: any
  result?: any
}
```

### Tool Abort Chunk

```typescript
interface LlmChunkToolAbort {
  type: 'tool_abort'
  reason: any
}
```

See [Streaming](/guide/streaming#chunk-types) for details.

## Examples

### Basic Usage

```typescript
const model = igniteModel('openai', chatModel, config)

const messages = [
  new Message('system', 'You are helpful'),
  new Message('user', 'Hello!')
]

const response = await model.complete(messages)
```

### With Streaming

```typescript
const stream = model.generate(messages, {
  temperature: 0.8,
  maxTokens: 500
})

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    process.stdout.write(chunk.text || '')
  }
}
```

### With Function Calling

```typescript
model.addPlugin(new WeatherPlugin())
model.addPlugin(new SearchPlugin())

const response = await model.complete(messages)
```

### With Abort

```typescript
const controller = new AbortController()

const promise = model.complete(messages, {
  abortSignal: controller.signal
})

setTimeout(() => controller.abort(), 5000)
```

## Next Steps

- Review [LlmEngine](/api/llm-engine) for the underlying engine
- See [Message](/api/message) for message objects
- Learn about [Plugin](/api/plugin) for function calling
