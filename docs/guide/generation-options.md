# Generation Options

Advanced model and provider-specific options for fine-tuning generation behavior.

## Overview

Beyond the standard completion options (`temperature`, `maxTokens`, etc.), multi-llm-ts supports provider-specific options that enable advanced features like reasoning modes, response continuity, and custom parameters.

## Common Options

These options work across all or most providers:

### maxTokens

Maximum number of tokens to generate:

```typescript
const response = await model.complete(messages, {
  maxTokens: 1000
})
```

**Supported:** All providers

### temperature

Randomness in generation (0-2):

```typescript
const response = await model.complete(messages, {
  temperature: 0.7  // More creative
})
```

**Supported:** All providers (with model-specific constraints)

### top_k

Top-K sampling for token selection:

```typescript
const response = await model.complete(messages, {
  top_k: 40
})
```

**Supported:** Anthropic, Google, Ollama, Mistral AI

**Note:** For OpenAI, this enables `logprobs` and `top_logprobs` instead of affecting sampling.

### top_p

Top-P (nucleus) sampling:

```typescript
const response = await model.complete(messages, {
  top_p: 0.9
})
```

**Supported:** Most providers

## OpenAI-Specific Options

Options for OpenAI models:

### useResponsesApi

Enable the OpenAI Responses API for multi-turn conversations:

```typescript
const response = await model.complete(messages, {
  useResponsesApi: true
})

// Get the response ID
console.log(response.openAIResponseId)
```

**Purpose:** Enables conversation continuity with response IDs for follow-up requests.

**See:** [OpenAI Responses API documentation](https://platform.openai.com/docs/api-reference/responses)

### responseId

Continue a previous conversation using its response ID:

```typescript
const response = await model.complete(messages, {
  useResponsesApi: true,
  responseId: previousResponseId  // Continue from previous response
})
```

**Requires:** `useResponsesApi: true`

### reasoningEffort

Control reasoning effort for o1-series models:

```typescript
const response = await model.complete(messages, {
  reasoningEffort: 'high'  // 'low' | 'medium' | 'high'
})
```

**Supported models:** o1-preview, o1-mini, o1, and DeepSeek reasoning models

**Purpose:** Balances speed vs. reasoning depth:
- `'low'`: Faster, less reasoning
- `'medium'`: Balanced
- `'high'`: Slower, deeper reasoning

### verbosity

Control output verbosity for verbosity-supporting models:

```typescript
const response = await model.complete(messages, {
  verbosity: 'medium'  // 'low' | 'medium' | 'high'
})
```

**Purpose:** Controls how detailed the model's output is.

## Anthropic-Specific Options

Options for Anthropic Claude models:

### reasoning

Enable extended thinking mode for Claude:

```typescript
const response = await model.complete(messages, {
  reasoning: true,
  reasoningBudget: 2048
})
```

**Purpose:** Enables Claude's extended thinking capability on models that support it.

**Default:** Automatically enabled for models with `capabilities.reasoning = true`, set to `false` to disable.

### reasoningBudget

Token budget for Claude's extended thinking:

```typescript
const response = await model.complete(messages, {
  reasoning: true,
  reasoningBudget: 2048  // Tokens allocated for thinking
})
```

**Default:** 1024 tokens

**Purpose:** Controls how many tokens Claude can use for internal reasoning before generating the response.

**Effect:**
- Higher budget: More thorough reasoning, potentially better quality
- Lower budget: Faster responses, less reasoning depth

## Google-Specific Options

Options for Google Gemini models:

### thinkingBudget

Token budget for Gemini's thinking process:

```typescript
const response = await model.complete(messages, {
  thinkingBudget: 1024
})
```

**Purpose:** Similar to Anthropic's `reasoningBudget`, controls the token allocation for Gemini's internal reasoning on models with `capabilities.reasoning = true`.

**Effect:** Enables `includeThoughts: true` and sets the thinking budget.

## Custom Provider Options

For provider-specific parameters not covered by the standard API:

### customOpts

Pass arbitrary options directly to the provider:

```typescript
// Ollama example
const response = await model.complete(messages, {
  customOpts: {
    num_ctx: 8192,
    num_predict: 1024,
    repeat_penalty: 1.1,
    seed: 42
  }
})
```

**Purpose:** Allows access to any provider-specific parameter not exposed by the unified API.

**Usage:**
- Ollama: Maps to `options` in the request
- Other providers: Merged into the request payload

**Example use cases:**
- Ollama: `num_ctx`, `num_predict`, `repeat_penalty`, `seed`, etc.
- Custom API endpoints: Provider-specific experimental features

## Complete Example

Combining multiple options:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

const models = await loadModels('anthropic', config)
const model = igniteModel('anthropic', models.chat[0], config)

const messages = [
  new Message('user', 'Solve this complex problem: ...')
]

const response = await model.complete(messages, {
  // Standard options
  temperature: 1.0,
  maxTokens: 4000,
  top_p: 0.95,
  top_k: 40,

  // Anthropic-specific
  reasoning: true,
  reasoningBudget: 4096,  // More thinking tokens

  // Cancel if needed
  abortSignal: controller.signal
})

console.log(response.content)
```

## Provider Support Matrix

| Option | OpenAI | Anthropic | Google | Ollama | Others |
|--------|--------|-----------|--------|--------|--------|
| `maxTokens` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `temperature` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `top_k` | ⚠️¹ | ✅ | ✅ | ✅ | ✅ |
| `top_p` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `contextWindowSize` | ❌ | ❌ | ❌ | ✅ | ❌ |
| `useResponsesApi` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `responseId` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `reasoningEffort` | ✅² | ❌ | ❌ | ❌ | ✅³ |
| `verbosity` | ✅² | ❌ | ❌ | ❌ | ❌ |
| `reasoning` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `reasoningBudget` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `thinkingBudget` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `customOpts` | ✅ | ✅ | ✅ | ✅ | ✅ |

¹ OpenAI: Enables logprobs instead of affecting sampling
² OpenAI: o1-series models only
³ DeepSeek reasoning models support `reasoningEffort`

## Next Steps

- Learn about [Structured Output](/guide/structured-output) for JSON generation
- Review [Abort Operations](/guide/abort) for cancellation
- See [Types](/api/types) for complete type definitions
