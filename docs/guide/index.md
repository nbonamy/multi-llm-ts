# Introduction

Welcome to **multi-llm-ts** documentation! This library provides a unified TypeScript interface for interacting with multiple Large Language Model (LLM) providers.

## Why multi-llm-ts?

Building applications that leverage LLMs can be challenging when you need to support multiple providers. Each provider has its own SDK, API conventions, and capabilities. **multi-llm-ts** solves this by providing:

- **Single API**: Write once, use with any supported provider
- **Type Safety**: Full TypeScript support with excellent IDE experience
- **Feature Parity**: Consistent support for streaming, function calling, vision, and more
- **Easy Migration**: Switch providers without rewriting your application logic

## Supported Providers

multi-llm-ts supports 10+ LLM providers including:

- **OpenAI** - GPT-4, GPT-3.5, and more
- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus/Haiku
- **Google** - Gemini Pro, Gemini Flash
- **Ollama** - Run models locally
- **Azure AI**, **Cerebras**, **DeepSeek**, **Groq**, **MistralAI**, **xAI**, and more

See the [Providers Overview](/guide/providers) for the complete list and feature matrix.

## Features

### Chat Completion & Streaming

Get completions from any LLM provider with support for streaming responses:

```typescript
const model = igniteModel('openai', chatModel, config)
const stream = model.generate(messages)
for await (const chunk of stream) {
  console.log(chunk)
}
```

### Function Calling

Build intelligent agents with tool use via an extensible plugin system:

```typescript
model.addPlugin(new ReadFilePlugin())
model.addPlugin(new WebSearchPlugin())
const result = await model.complete(messages)
```

### Vision Support

Analyze images with vision-capable models:

```typescript
const message = new Message('user', 'What is in this image?')
message.attach({ url: 'image.jpg', mimeType: 'image/jpeg' })
const result = await model.complete([message])
```

### Structured Output

Generate JSON with schema validation:

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number()
})
const result = await model.complete(messages, { schema })
```

## Next Steps

- [Install the library](/guide/installation)
- [Quick Start Guide](/guide/quick-start)
- [Learn about Providers](/guide/providers)
