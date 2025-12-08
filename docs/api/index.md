# API Reference

Complete API reference for multi-llm-ts.

## Core Classes

### [LlmModel](/api/llm-model)

The main abstraction that wraps an engine and model together. Recommended for most use cases.

```typescript
const model = igniteModel('openai', chatModel, config)
await model.complete(messages)
```

### [LlmEngine](/api/llm-engine)

Low-level engine interface for advanced use cases. LlmModel wraps this internally.

```typescript
const engine = igniteEngine('openai', config)
await engine.complete(messages, chatModel)
```

### [Message](/api/message)

Represents a message in the conversation with support for attachments.

```typescript
const message = new Message('user', 'Hello!')
message.attach({ url: 'image.jpg', mimeType: 'image/jpeg' })
```

### [Plugin](/api/plugin)

Base class for creating custom tools/functions that the LLM can invoke.

```typescript
class MyPlugin extends Plugin {
  async execute(context, parameters) {
    // Your tool logic
  }
}
```

## Helper Functions

### `igniteModel()`

Create an LlmModel instance:

```typescript
function igniteModel(
  provider: string,
  model: ChatModel,
  config: EngineConfig
): LlmModel
```

### `igniteEngine()`

Create an LlmEngine instance:

```typescript
function igniteEngine(
  provider: string,
  config: EngineConfig
): LlmEngine
```

### `loadModels()`

Load available models from a provider:

```typescript
async function loadModels(
  provider: string,
  config: EngineConfig
): Promise<ModelsResponse>
```

## Type Definitions

See [Types](/api/types) for a complete reference of all TypeScript types, interfaces, and enums.

## Provider IDs

Valid provider identifiers:

- `'openai'` - OpenAI (also used for TogetherAI)
- `'anthropic'` - Anthropic
- `'google'` - Google
- `'ollama'` - Ollama
- `'azure'` - Azure AI
- `'cerebras'` - Cerebras
- `'deepseek'` - DeepSeek
- `'groq'` - Groq
- `'meta'` - Meta/Llama
- `'mistralai'` - MistralAI
- `'openrouter'` - OpenRouter
- `'xai'` - xAI
