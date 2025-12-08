# Streaming

Generate responses in real-time with streaming for better user experience.

## Basic Streaming

The `generate()` method returns an async generator that yields chunks as they arrive:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'Tell me a short story')
]

const stream = model.generate(messages)

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    process.stdout.write(chunk.text || '')
  }
}
```

## Chunk Types

The generator yields different types of chunks:

### Content Chunks

Text content as it's generated:

```typescript
interface LlmChunkContent {
  type: 'content'
  text?: string          // Text delta
  textDelta?: string     // Alternative field (provider-dependent)
}
```

### Tool Chunks

Tool execution status:

```typescript
interface LlmChunkTool {
  type: 'tool'
  name: string           // Tool/function name
  status: string         // Human-readable status
  state: 'preparing' | 'running' | 'completed' | 'canceled' | 'error'
  parameters?: any       // Tool parameters (when running)
  result?: any           // Tool result (when completed)
}
```

### Tool Abort Chunks

When tool validation aborts generation:

```typescript
interface LlmChunkToolAbort {
  type: 'tool_abort'
  reason: any            // Abort reason from validation
}
```

## Handling Different Chunks

Process chunks based on their type:

```typescript
const stream = model.generate(messages)

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'content':
      // Display text to user
      process.stdout.write(chunk.text || '')
      break

    case 'tool':
      // Show tool execution status
      console.log(`[${chunk.state}] ${chunk.status}`)
      break

    case 'tool_abort':
      // Handle abort
      console.log('Generation aborted:', chunk.reason)
      break
  }
}
```

## Using Options

Customize generation with the same options as `complete()`:

```typescript
const stream = model.generate(messages, {
  temperature: 0.7,
  maxTokens: 1000,
  abortSignal: controller.signal
})
```

See [Generation Options](/guide/generation-options) for all available options including temperature, maxTokens, reasoning modes, and provider-specific features.

## Building UI with Streaming

### Console Output

```typescript
for await (const chunk of stream) {
  if (chunk.type === 'content') {
    process.stdout.write(chunk.text || '')
  }
}
console.log()  // Newline at end
```

### React Component

```typescript
function ChatResponse() {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    async function generate() {
      const stream = model.generate(messages)

      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          setContent(prev => prev + (chunk.text || ''))
        } else if (chunk.type === 'tool') {
          setStatus(chunk.status)
        }
      }

      setStatus('')  // Clear status when done
    }

    generate()
  }, [])

  return (
    <div>
      <pre>{content}</pre>
      {status && <div className="status">{status}</div>}
    </div>
  )
}
```

### Node.js Stream

```typescript
import { Readable } from 'stream'

const stream = model.generate(messages)
const readable = Readable.from(async function* () {
  for await (const chunk of stream) {
    if (chunk.type === 'content' && chunk.text) {
      yield chunk.text
    }
  }
}())

readable.pipe(process.stdout)
```

## Next Steps

- Learn about [Function Calling](/guide/function-calling) with tool status visibility
- Implement [Abort Operations](/guide/abort) for cancellation
- Use [Tool Validation](/guide/tool-validation) to control execution
