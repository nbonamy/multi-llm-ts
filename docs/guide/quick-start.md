# Quick Start

This guide will walk you through creating your first application with multi-llm-ts.

## Basic Example

Here's a complete example showing how to query an LLM:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

async function main() {
  // 1. Load available models for a provider
  const config = { apiKey: process.env.OPENAI_API_KEY }
  const models = await loadModels('openai', config)

  // 2. Create an LlmModel instance
  const model = igniteModel('openai', models.chat[0], config)

  // 3. Create messages
  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'What is the capital of France?')
  ]

  // 4. Get completion
  const response = await model.complete(messages)

  console.log(response.content)
  // Output: "The capital of France is Paris."
}

main()
```

## Streaming Example

To stream responses token by token:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

async function streamExample() {
  const config = { apiKey: process.env.OPENAI_API_KEY }
  const models = await loadModels('openai', config)
  const model = igniteModel('openai', models.chat[0], config)

  const messages = [
    new Message('system', 'You are a helpful assistant'),
    new Message('user', 'Tell me a short story')
  ]

  // Generate returns an async generator
  const stream = model.generate(messages)

  for await (const chunk of stream) {
    if (chunk.type === 'content') {
      process.stdout.write(chunk.text || '')
    }
  }
}

streamExample()
```

## Using Different Providers

Switching providers is as simple as changing the provider ID:

::: code-group

```typescript [OpenAI]
const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)
```

```typescript [Anthropic]
const config = { apiKey: process.env.ANTHROPIC_API_KEY }
const models = await loadModels('anthropic', config)
const model = igniteModel('anthropic', models.chat[0], config)
```

```typescript [Google]
const config = { apiKey: process.env.GOOGLE_API_KEY }
const models = await loadModels('google', config)
const model = igniteModel('google', models.chat[0], config)
```

```typescript [Ollama]
const config = { baseURL: 'http://localhost:11434' }
const models = await loadModels('ollama', config)
const model = igniteModel('ollama', models.chat[0], config)
```

:::

## Next Steps

Now that you have the basics, explore key features:

**Start here:**
- **[Streaming](/guide/streaming)** - Stream responses in real-time (recommended for most applications)
- **[Messages](/guide/messages)** - Build multi-turn conversations with proper message structure

**Core features:**
- **[Function Calling](/guide/function-calling)** - Let models invoke tools and functions
- **[Models](/guide/models)** - Select and configure models with specific capabilities
- **[Providers](/guide/providers)** - Configure different LLM providers

**Advanced:**
- **[Generation Options](/guide/generation-options)** - Control temperature, reasoning modes, and more
- **[Structured Output](/guide/structured-output)** - Get JSON responses with type safety
- **[Vision](/guide/vision)** - Analyze images with vision-capable models
