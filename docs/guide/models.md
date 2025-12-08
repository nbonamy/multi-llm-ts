# Models

Understanding models and how to work with them in multi-llm-ts.

## What are Models?

Models are the AI systems that generate responses. Each provider offers different models with varying capabilities, costs, and performance characteristics.

## Loading Models

Use `loadModels()` to fetch available models from a provider:

```typescript
import { loadModels } from 'multi-llm-ts'

const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)

console.log(models.chat)    // Chat models
console.log(models.image)   // Image generation models (if available)
```

The response includes:
- `chat`: Array of chat completion models
- `image`: Array of image generation models (provider-dependent)

## ChatModel Object

Each model has these properties:

```typescript
interface ChatModel {
  id: string              // Model identifier (e.g., "gpt-4")
  name: string            // Display name
  meta?: any              // Provider-specific metadata

  // Capabilities
  capabilities?: {
    tools: boolean        // Supports function calling
    vision: boolean       // Can analyze images
    reasoning: boolean    // Chain-of-thought models (o1 family)
  }
}
```

## Creating an LlmModel

Once you have a model, create an `LlmModel` instance:

```typescript
import { igniteModel } from 'multi-llm-ts'

const model = igniteModel('openai', models.chat[0], config)
```

**Parameters:**
- `provider`: Provider ID (e.g., `'openai'`, `'anthropic'`)
- `model`: ChatModel object from `loadModels()`
- `config`: Configuration with API key and options

**Usage:**
```typescript
// Simple API - no need to pass model to each call
await model.complete(messages)
```

## Model Selection

Choose models based on your needs:

### By Capability

```typescript
// Find a vision model
const visionModel = models.chat.find(m => m.capabilities?.vision)
const model = igniteModel('openai', visionModel, config)

// Find a model with function calling
const toolModel = models.chat.find(m => m.capabilities?.tools)
```

### By Name

```typescript
// Use a specific model
const gpt4 = models.chat.find(m => m.id === 'gpt-4')
const model = igniteModel('openai', gpt4, config)
```

## Model Capabilities

### Function Calling (Tools)

Models with `capabilities.tools = true` can invoke functions/plugins:

```typescript
if (chatModel.capabilities?.tools) {
  model.addPlugin(new MyPlugin())
}
```

See [Function Calling](/guide/function-calling) for details.

### Vision

Models with `capabilities.vision = true` can analyze images:

```typescript
if (chatModel.capabilities?.vision) {
  const message = new Message('user', 'What is in this image?')
  message.attach({ url: 'image.jpg', mimeType: 'image/jpeg' })
  await model.complete([message])
}
```

See [Vision](/guide/vision) for details.

### Reasoning

Models with `capabilities.reasoning = true` (like OpenAI's o1 family) use chain-of-thought reasoning:

```typescript
// Reasoning models have different parameter constraints
// - Cannot use system messages
// - Limited temperature/top_p control
const response = await model.complete(messages)
```

## Next Steps

- Learn about [Messages](/guide/messages) and conversation structure
- Explore [Completion](/guide/completion) for generating responses
- Try [Streaming](/guide/streaming) for real-time output
