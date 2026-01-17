# Providers Overview

multi-llm-ts supports multiple LLM providers with a consistent API. This page provides an overview of supported providers and their capabilities.

## Supported Providers

| Provider | ID | Completion | Vision | Function Calling | Reasoning | Structured Output | Usage Reporting | Computer Use |
|----------|-----|------------|--------|------------------|-----------|-------------------|-----------------|--------------|
| **Anthropic** | `anthropic` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **Azure AI** | `azure` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Cerebras** | `cerebras` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |
| **DeepSeek** | `deepseek` | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Google** | `google` | ✅ | ✅ | ✅ | ✅ | ✅¹ | ✅ | ✅ |
| **Groq** | `groq` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Meta/Llama** | `meta` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **MistralAI** | `mistralai` | ✅ | ✅ | ✅ | ❌ | ✅¹ | ✅ | ❌ |
| **Ollama** | `ollama` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **OpenAI** | `openai` | ✅ | ✅² | ✅² | ✅ | ✅ | ✅ | ❌ |
| **OpenRouter** | `openrouter` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **TogetherAI**³ | `openai` | ✅ | ✅² | ✅² | ❌ | ✅ | ✅ | ❌ |
| **xAI** | `xai` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |

**Notes:**
1. Provider supports JSON output but does not enforce a specific schema. You need to describe the schema in the user message.
2. Not supported for o1 family models.
3. TogetherAI uses the `openai` provider ID. Set `baseURL` to `https://api.together.xyz/v1`

## Feature Descriptions

### Completion & Streaming
All providers support both synchronous completion and streaming responses.

### Vision
Vision-capable models can analyze images provided as attachments. See [Vision Guide](/guide/vision) for usage.

### Function Calling
Function calling allows models to invoke tools/plugins. See [Function Calling Guide](/guide/function-calling) for usage.

### Reasoning
Reasoning models like OpenAI's o1 family use chain-of-thought reasoning for complex problems.

### Structured Output
Generate JSON responses validated against a schema using Zod. See [Structured Output Guide](/guide/structured-output).

### Usage Reporting
Tracks token usage (prompt, completion, and total tokens) for cost estimation.

### Computer Use
Experimental feature allowing models to interact with computer interfaces (currently Anthropic and Google only).

## Configuration

Basic configuration for any provider:

```typescript
import { igniteModel, loadModels } from 'multi-llm-ts'

const config = {
  apiKey: 'YOUR_API_KEY',           // Required for cloud providers
  baseURL: 'https://api.custom.com', // Optional custom endpoint
  timeout: 30000,                    // Optional request timeout (ms)
  requestCooldown: 2000,             // Optional cooldown between requests (ms)
}

const models = await loadModels('PROVIDER_ID', config)
const model = igniteModel('PROVIDER_ID', models.chat[0], config)
```

### Request Cooldown

The `requestCooldown` option helps avoid hitting API rate limits during tool execution loops. When the model returns tool calls, executes them locally, and sends results back to the API, rapid successive requests can trigger rate limits—especially on free tiers.

```typescript
const config = {
  apiKey: 'YOUR_API_KEY',
  requestCooldown: 2000,  // Minimum 2 seconds between API request starts
}
```

**How it works:**
- Uses a **start-start** timing model (recommended by OpenAI/Anthropic token bucket algorithms)
- Records when each API request begins
- Before the next request, calculates remaining cooldown time
- Only waits if processing took less than the cooldown period

**Example:** With a 2000ms cooldown:
- If tool execution takes 500ms → waits 1500ms before next API call
- If tool execution takes 3000ms → no additional wait needed

This approach maximizes throughput while respecting rate limits.
