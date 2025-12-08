# multi-llm-ts

<img src="https://github.com/nbonamy/multi-llm-ts/actions/workflows/test.yml/badge.svg">

A TypeScript library to use LLM provider APIs in a unified way.

**📚 [Full Documentation](https://nbonamy.github.io/multi-llm-ts/)**

## Features

- **Universal API** - Single interface for all providers
- **Streaming** - Real-time token-by-token responses
- **Function Calling** - Let models invoke tools and plugins
- **Vision** - Analyze images with vision-capable models
- **Structured Output** - Type-safe JSON responses with Zod schemas
- **Multi-turn Conversations** - Build complex chat applications
- **Abort Support** - Cancel operations gracefully
- **Usage Reporting** - Track token consumption

## Quick Start

```bash
npm install multi-llm-ts
```

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

// Load models and create an instance
const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

// Generate a response
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?')
]

const response = await model.complete(messages)
console.log(response.content)
// Output: "The capital of France is Paris."
```

**→ [Continue with Quick Start Guide](https://nbonamy.github.io/multi-llm-ts/guide/quick-start)**

## Supported Providers

- Anthropic
- Azure AI
- Cerebras
- DeepSeek
- Google
- Groq
- Meta/Llama
- MistralAI
- Ollama
- OpenAI
- OpenRouter
- xAI

**→ [See detailed feature coverage](https://nbonamy.github.io/multi-llm-ts/guide/providers)**

## Examples

Check out the [demo project](https://github.com/nbonamy/mlts-demo) for a real-world implementation.

```bash
# Run basic example
npm install
API_KEY=your-openai-api-key npm run example

# Run with different provider
API_KEY=your-anthropic-key ENGINE=anthropic npm run example
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details
