# LlmEngine

Low-level engine interface for advanced use cases.

## Overview

`LlmEngine` is the underlying engine that powers `LlmModel`. Use it when you need more control or want to work with multiple models dynamically.

**Recommendation**: Use [LlmModel](/api/llm-model) for most cases. Only use `LlmEngine` if you need to switch models frequently or require advanced control.

```typescript
import { igniteEngine, Message } from 'multi-llm-ts'

const config = { apiKey: 'API_KEY' }
const engine = igniteEngine('openai', config)

// Must pass model to each operation
await engine.complete(chatModel, messages)
```

## Creating an LlmEngine

### igniteEngine()

```typescript
function igniteEngine(
  provider: string,
  config: EngineConfig
): LlmEngine
```

**Parameters:**
- `provider`: Provider ID (`'openai'`, `'anthropic'`, etc.)
- `config`: Configuration with API key and options

**Example:**
```typescript
const engine = igniteEngine('google', {
  apiKey: process.env.GOOGLE_API_KEY
})
```

## Methods

### complete()

Generate a complete response:

```typescript
async complete(
  model: ChatModel,
  messages: Message[],
  opts?: LlmCompletionOpts
): Promise<LlmResponse>
```

**Parameters:**
- `model`: ChatModel to use
- `messages`: Array of Message objects
- `opts`: Optional generation parameters

**Example:**
```typescript
const response = await engine.complete(chatModel, messages, {
  temperature: 0.7
})
```

### generate()

Generate a streaming response:

```typescript
generate(
  model: ChatModel,
  messages: Message[],
  opts?: LlmCompletionOpts
): AsyncGenerator<LlmChunk>
```

**Parameters:**
- `model`: ChatModel to use
- `messages`: Array of Message objects
- `opts`: Optional generation parameters

**Example:**
```typescript
const stream = engine.generate(chatModel, messages)

for await (const chunk of stream) {
  console.log(chunk)
}
```

### addPlugin()

Register a plugin:

```typescript
addPlugin(plugin: Plugin): void
```

**Example:**
```typescript
engine.addPlugin(new MyPlugin())
```

### buildModel()

Create a ChatModel from a model ID:

```typescript
buildModel(id: string): ChatModel
```

**Example:**
```typescript
const chatModel = engine.buildModel('gpt-4')
await engine.complete(chatModel, messages)
```

## EngineConfig

Configuration for engine creation:

```typescript
interface EngineConfig {
  apiKey?: string
  baseURL?: string
  timeout?: number
  useOpenAIResponsesApi?: boolean
  customOpts?: Record<string, any>
}
```

**Fields:**
- `apiKey`: API key for the provider
- `baseURL`: Custom API endpoint
- `timeout`: Request timeout in milliseconds
- `useOpenAIResponsesApi`: Use OpenAI Responses API
- `customOpts`: Provider-specific options

**Example:**
```typescript
const config = {
  apiKey: 'KEY',
  baseURL: 'https://custom.api.com',
  timeout: 60000,
  customOpts: {
    // Ollama example
    num_ctx: 8192
  }
}
```

## When to Use LlmEngine

### Dynamic Model Selection

When switching models frequently:

```typescript
const engine = igniteEngine('openai', config)

const models = await loadModels('openai', config)

// Use different models
await engine.complete(models.chat[0], messages)  // GPT-4
await engine.complete(models.chat[1], messages)  // GPT-3.5
```

### Multiple Providers

Managing multiple providers:

```typescript
const openaiEngine = igniteEngine('openai', configOpenAI)
const anthropicEngine = igniteEngine('anthropic', configAnthropic)

// Use different providers
const response1 = await openaiEngine.complete(gpt4Model, messages)
const response2 = await anthropicEngine.complete(claudeModel, messages)
```

### Advanced Control

Fine-grained control over model selection:

```typescript
async function generateWithFallback(messages: Message[]) {
  const models = await loadModels('openai', config)

  // Try flagship model first
  try {
    return await engine.complete(models.chat[0], messages)
  } catch (error) {
    // Fall back to cheaper model
    return await engine.complete(models.chat[1], messages)
  }
}
```

## Comparison

| Feature | LlmModel | LlmEngine |
|---------|----------|-----------|
| **API simplicity** | ✅ Simple | ⚠️ Verbose |
| **Model binding** | Bound to one model | Dynamic |
| **Plugin management** | Per-model | Shared |
| **Use case** | Standard usage | Advanced scenarios |

## Migration from LlmEngine to LlmModel

**Before (v4.0):**
```typescript
const engine = igniteEngine('openai', config)
const models = await loadModels('openai', config)

await engine.complete(models.chat[0], messages)
```

**After (v4.5+):**
```typescript
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

await model.complete(messages)
```

## Examples

### Basic Usage

```typescript
const engine = igniteEngine('anthropic', config)
const models = await loadModels('anthropic', config)
const claudeModel = models.chat[0]

const response = await engine.complete(claudeModel, messages)
```

### Model Switching

```typescript
const engine = igniteEngine('openai', config)
const models = await loadModels('openai', config)

// Use GPT-4 for complex tasks
const response1 = await engine.complete(models.chat[0], complexMessages)

// Use GPT-3.5 for simple tasks
const response2 = await engine.complete(models.chat[1], simpleMessages)
```

### buildModel()

```typescript
const engine = igniteEngine('openai', config)

// Quick model creation without loadModels()
const model = engine.buildModel('gpt-4')

await engine.complete(model, messages)
```

## Next Steps

- Use [LlmModel](/api/llm-model) for simpler API
- Learn about [ChatModel](/api/types#chatmodel)
- Review [Configuration](/guide/providers#configuration)
