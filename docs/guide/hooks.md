# Hooks

Intercept and modify engine behavior during execution.

## Overview

Hooks allow you to intercept execution at specific points, inspect context, and modify data before it's used. This is particularly useful for:

- **Context management**: Truncate or summarize previous tool results to prevent context overflow
- **Logging/debugging**: Inspect tool execution data for debugging purposes
- **Custom transformations**: Modify tool results before the next model call

## Available Hooks

### beforeToolCallsResponse

Called after all tool calls in a round have been executed, before the model is prompted again with the results. This hook provides access to the full tool history and allows you to modify tool results before they are sent back to the model.

```typescript
import { igniteEngine } from 'multi-llm-ts'

const engine = igniteEngine('openai', config)

engine.addHook('beforeToolCallsResponse', (context) => {
  // context contains:
  // - toolHistory: all tool calls across all rounds
  // - currentRound: the current round number (0-indexed)
  // - toolCalls: tool calls from the current round
  // - model, opts, usage, etc.

  for (const entry of context.toolHistory) {
    console.log(`Tool: ${entry.name}, Round: ${entry.round}`)
    console.log(`Args: ${JSON.stringify(entry.args)}`)
    console.log(`Result: ${JSON.stringify(entry.result)}`)
  }
})
```

## Context Management (Truncation)

When using tools that return large results, previous tool results accumulate in the conversation thread, potentially causing context overflow. Use the `beforeToolCallsResponse` hook to truncate or summarize old tool results:

```typescript
const engine = igniteEngine('openai', config)

engine.addHook('beforeToolCallsResponse', (context) => {
  // Truncate results from previous rounds to save context
  for (const entry of context.toolHistory) {
    if (entry.round < context.currentRound) {
      // Replace previous results with a truncated version
      entry.result = '[previous result truncated]'
    }
  }
  // The engine automatically syncs these changes back to the thread
})
```

### Selective Truncation

You can apply more sophisticated logic based on tool name, result size, or other criteria:

```typescript
engine.addHook('beforeToolCallsResponse', (context) => {
  for (const entry of context.toolHistory) {
    // Only truncate results from specific tools
    if (entry.name === 'web_search' && entry.round < context.currentRound) {
      // Keep only the first 500 characters
      const result = JSON.stringify(entry.result)
      if (result.length > 500) {
        entry.result = { summary: result.slice(0, 500) + '...' }
      }
    }

    // Truncate all results older than 2 rounds
    if (entry.round < context.currentRound - 2) {
      entry.result = `[result from round ${entry.round} truncated]`
    }
  }
})
```

## Tool History

Each entry in `toolHistory` has the following structure:

```typescript
type ToolHistoryEntry = {
  id: string      // Unique identifier for this tool call
  name: string    // Tool/function name
  args: any       // Arguments passed to the tool
  result: any     // Result returned by the tool
  round: number   // Round number (0-indexed)
}
```

## Unsubscribing

`addHook` returns an unsubscribe function:

```typescript
const unsubscribe = engine.addHook('beforeToolCallsResponse', callback)

// Later, when you want to remove the hook:
unsubscribe()
```

## Multiple Hooks

You can register multiple hooks for the same event. They execute in registration order:

```typescript
// Logging hook
engine.addHook('beforeToolCallsResponse', (context) => {
  console.log('Tool calls completed:', context.toolHistory.length)
})

// Truncation hook
engine.addHook('beforeToolCallsResponse', (context) => {
  for (const entry of context.toolHistory) {
    if (entry.round < context.currentRound) {
      entry.result = '[truncated]'
    }
  }
})
```

## Provider Differences

The hook system works consistently across all providers. While internal thread formats differ (OpenAI uses `tool_call_id`, Anthropic nests results in user messages, Google uses `functionResponse`, etc.), the `toolHistory` provides a unified view that you can safely modify. The engine automatically syncs your changes back to the provider-specific format.

## Best Practices

1. **Be careful with result modification**: The model will see your modified results, which may affect its reasoning. Ensure truncated data still provides useful context.

2. **Use round numbers strategically**: Keep recent results intact and only truncate older rounds to preserve conversation flow.

3. **Consider result size**: Large results (like web search content) are prime candidates for truncation. Smaller results (like simple function returns) may not need modification.

4. **Test with your use case**: Different models may handle truncated context differently. Test to ensure your truncation strategy works well with your specific provider and model.

## Next Steps

- Learn about [Plugins](/guide/plugins) to understand tool execution
- Implement [Tool Validation](/guide/tool-validation) for security
- Handle [Abort Operations](/guide/abort) properly
