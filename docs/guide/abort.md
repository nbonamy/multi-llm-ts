# Abort Operations

Cancel ongoing LLM operations using AbortController.

## Overview

All `complete()` and `generate()` operations support cancellation via standard Web API `AbortSignal`. This allows you to:
- Stop generation when users click "Stop"
- Implement timeouts
- Cancel when user navigates away
- Stop on specific conditions

## Basic Usage

### With Completion

```typescript
import { igniteModel, Message } from 'multi-llm-ts'

const controller = new AbortController()

// Start completion
const promise = model.complete(messages, {
  abortSignal: controller.signal
})

// Cancel after 5 seconds
setTimeout(() => {
  controller.abort()
}, 5000)

try {
  const response = await promise
  console.log(response.content)
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Completion was cancelled')
  }
}
```

### With Streaming

```typescript
const controller = new AbortController()

const stream = model.generate(messages, {
  abortSignal: controller.signal
})

// Start processing
const process = async () => {
  try {
    for await (const chunk of stream) {
      console.log(chunk)
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Stream was cancelled')
    }
  }
}

process()

// Cancel from elsewhere
document.getElementById('stopBtn').onclick = () => {
  controller.abort()
}
```

## Use Cases

### User Stop Button

```typescript
let currentController: AbortController | null = null

async function startGeneration() {
  // Cancel previous generation if any
  currentController?.abort()

  // Create new controller
  currentController = new AbortController()

  try {
    const stream = model.generate(messages, {
      abortSignal: currentController.signal
    })

    for await (const chunk of stream) {
      displayChunk(chunk)
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      showMessage('Generation stopped')
    }
  } finally {
    currentController = null
  }
}

function stopGeneration() {
  currentController?.abort()
}
```

### Timeout

```typescript
async function generateWithTimeout(messages, timeout = 30000) {
  const controller = new AbortController()

  // Set timeout
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeout)

  try {
    const response = await model.complete(messages, {
      abortSignal: controller.signal
    })

    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)

    if (error.name === 'AbortError') {
      throw new Error('Request timed out')
    }

    throw error
  }
}
```

### Navigation Cleanup

```typescript
// React example
useEffect(() => {
  const controller = new AbortController()

  async function generate() {
    try {
      const stream = model.generate(messages, {
        abortSignal: controller.signal
      })

      for await (const chunk of stream) {
        setContent(prev => prev + chunk.text)
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(error)
      }
    }
  }

  generate()

  // Cleanup on unmount
  return () => {
    controller.abort()
  }
}, [])
```

### Conditional Cancellation

```typescript
const controller = new AbortController()

const stream = model.generate(messages, {
  abortSignal: controller.signal
})

let wordCount = 0

for await (const chunk of stream) {
  if (chunk.type === 'content' && chunk.text) {
    wordCount += chunk.text.split(' ').length

    // Stop if too long
    if (wordCount > 1000) {
      controller.abort()
      break
    }
  }
}
```

## Plugin Abort Support

Plugins automatically receive abort signals:

```typescript
import { Plugin, PluginExecutionContext } from 'multi-llm-ts'

export class MyPlugin extends Plugin {

  async execute(
    context: PluginExecutionContext,
    parameters: any
  ): Promise<any> {

    // Option 1: Use helper
    const result = await this.runWithAbort(
      fetch('https://api.example.com/data', {
        signal: context.abortSignal
      }),
      context.abortSignal
    )

    // Option 2: Manual checking
    if (context.abortSignal?.aborted) {
      throw new Error('Operation cancelled')
    }

    // Option 3: Pass to async operations
    const response = await fetch(url, {
      signal: context.abortSignal
    })

    return result
  }
}
```

### runWithAbort Helper

The `runWithAbort()` helper method:

```typescript
async execute(context, params) {
  const result = await this.runWithAbort(
    longRunningOperation(params),
    context.abortSignal,
    () => {
      // Optional cleanup
      cleanup()
    }
  )

  return result
}
```

Benefits:
- Automatically throws `AbortError` if aborted
- Runs cleanup callback on abort
- Returns result if completed normally

## Error Handling

### Distinguishing Abort Errors

```typescript
try {
  const response = await model.complete(messages, {
    abortSignal: controller.signal
  })
} catch (error) {
  if (error.name === 'AbortError') {
    // User cancelled - not an error condition
    console.log('Operation cancelled by user')
  } else {
    // Actual error - log and report
    console.error('Request failed:', error)
    reportError(error)
  }
}
```

### Silent Cancellation

Sometimes you want to ignore abort errors:

```typescript
try {
  await model.complete(messages, { abortSignal: controller.signal })
} catch (error) {
  if (error.name !== 'AbortError') {
    throw error  // Re-throw non-abort errors
  }
  // Silently ignore abort
}
```

## Multiple Operations

### Cancel All

```typescript
class ChatManager {
  private controller = new AbortController()

  async sendMessage(message: string) {
    // All operations share same controller
    const signal = this.controller.signal

    // Start multiple operations
    const [response1, response2] = await Promise.all([
      model1.complete(messages, { abortSignal: signal }),
      model2.complete(messages, { abortSignal: signal })
    ])

    return [response1, response2]
  }

  cancelAll() {
    this.controller.abort()
    this.controller = new AbortController()  // Reset
  }
}
```

### Cancel Individual

```typescript
const controllers = new Map<string, AbortController>()

function startGeneration(id: string) {
  const controller = new AbortController()
  controllers.set(id, controller)

  model.generate(messages, {
    abortSignal: controller.signal
  })
}

function cancelGeneration(id: string) {
  const controller = controllers.get(id)
  controller?.abort()
  controllers.delete(id)
}

function cancelAll() {
  controllers.forEach(c => c.abort())
  controllers.clear()
}
```

## Best Practices

1. **Always handle AbortError**: Distinguish from real errors
2. **Cleanup controllers**: Remove references after abort
3. **Pass to plugins**: Ensure plugins respect abort signal
4. **User feedback**: Show when operation is cancelled
5. **Idempotent abort**: Safe to call `abort()` multiple times
6. **Test cancellation**: Include abort scenarios in tests

## Streaming Considerations

During streaming, abort stops immediately:

```typescript
const controller = new AbortController()

const stream = model.generate(messages, {
  abortSignal: controller.signal
})

let chunkCount = 0

try {
  for await (const chunk of stream) {
    chunkCount++
    console.log(`Chunk ${chunkCount}`)

    // Abort immediately stops iteration
    if (chunkCount === 5) {
      controller.abort()
      // No more chunks will be received
    }
  }
} catch (error) {
  console.log(`Stopped at chunk ${chunkCount}`)
}
```

## Tool Execution

When tools are executing, abort stops them:

```typescript
const controller = new AbortController()

model.addPlugin(new LongRunningPlugin())

const stream = model.generate(messages, {
  abortSignal: controller.signal
})

for await (const chunk of stream) {
  if (chunk.type === 'tool' && chunk.state === 'running') {
    console.log('Tool is running...')

    // Abort during tool execution
    controller.abort()
    // Tool's execute() will receive AbortError
  }
}
```

Tool execution states:
- Tool receives abort signal via `context.abortSignal`
- Tool should check signal and clean up
- Tool execution throws `AbortError`
- Stream stops immediately

## Next Steps

- Learn about [Plugins](/guide/plugins) and abort handling
- Implement [Tool Validation](/guide/tool-validation)
- Review [Streaming](/guide/streaming) patterns
