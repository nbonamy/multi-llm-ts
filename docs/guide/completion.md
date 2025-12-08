# Completion

Generate complete responses from LLM models synchronously.

## Basic Completion

The `complete()` method generates a full response before returning:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?')
]

const response = await model.complete(messages)
console.log(response.content)
// Output: "The capital of France is Paris."
```

## Response Object

The `complete()` method returns a `LlmResponse` object:

```typescript
interface LlmResponse {
  type: 'text'
  content: string           // The generated text
  finishReason?: string     // Why generation stopped

  // Token usage (if available)
  usage?: {
    prompt: number          // Input tokens
    completion: number      // Output tokens
    total: number           // Total tokens
  }
}
```

### Finish Reasons

Common finish reasons:
- `'stop'` - Natural completion (most common)
- `'length'` - Hit max token limit
- `'content_filter'` - Blocked by content filter
- `'tool_calls'` - Stopped to execute function calls

## Using Options

Customize generation with completion options:

```typescript
const response = await model.complete(messages, {
  temperature: 0.7,
  maxTokens: 500,
  abortSignal: controller.signal
})
```

See [Generation Options](/guide/generation-options) for all available options including temperature, maxTokens, reasoning modes, and provider-specific features.

## Next Steps

- Review [Generation Options](/guide/generation-options) for advanced parameters
- Learn about [Streaming](/guide/streaming) for real-time output
- Build [Messages](/guide/messages) for multi-turn conversations
- Add [Function Calling](/guide/function-calling) capabilities
- Use [Structured Output](/guide/structured-output) for JSON
- Implement [Abort Operations](/guide/abort) for cancellation
