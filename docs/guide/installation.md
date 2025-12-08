# Installation

## Prerequisites

- Node.js 16.x or higher
- npm, yarn, or pnpm

## Install via npm

```bash
npm install multi-llm-ts
```

## Install via yarn

```bash
yarn add multi-llm-ts
```

## Install via pnpm

```bash
pnpm add multi-llm-ts
```

## Verify Installation

Create a simple test file to verify the installation:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

console.log('multi-llm-ts installed successfully!')
```

## TypeScript Configuration

multi-llm-ts is built with TypeScript and includes type definitions. Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true
  }
}
```

## Provider-Specific Setup

Depending on which LLM providers you plan to use, you may need to obtain API keys:

- **OpenAI**: Get your API key from [platform.openai.com](https://platform.openai.com)
- **Anthropic**: Get your API key from [console.anthropic.com](https://console.anthropic.com)
- **Google**: Get your API key from [aistudio.google.com](https://aistudio.google.com)
- **Ollama**: [Install Ollama](https://ollama.ai) to run models locally (no API key needed)

Store your API keys securely using environment variables:

```bash
export OPENAI_API_KEY="your-key-here"
export ANTHROPIC_API_KEY="your-key-here"
```

## Next Steps

Now that you have multi-llm-ts installed, continue to the [Quick Start Guide](/guide/quick-start) to build your first application.
