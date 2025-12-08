# Tool Validation

Control tool execution with validation callbacks for security and user confirmation.

## Overview

Tool validation allows you to:
- Approve or deny tool execution
- Require user confirmation
- Enforce security policies
- Audit tool usage
- Abort on dangerous operations

## Basic Usage

Provide a validation callback to `complete()` or `generate()`:

```typescript
import { igniteModel, Message } from 'multi-llm-ts'

const validateToolExecution = async (context, tool, args) => {
  // Your validation logic
  return { decision: 'allow' }
}

const response = await model.complete(messages, {
  toolExecutionValidation: validateToolExecution
})
```

## Validation Callback

The callback receives:

```typescript
async function validateToolExecution(
  context: PluginExecutionContext,
  tool: string,
  args: any
): Promise<ValidationResponse>
```

**Parameters:**
- `context`: Execution context (modelId, abortSignal)
- `tool`: Tool name being invoked
- `args`: Arguments passed to the tool

**Returns:**
```typescript
interface ValidationResponse {
  decision: 'allow' | 'deny' | 'abort'
  extra?: any  // Additional data
}
```

## Validation Decisions

### Allow

Execute the tool normally:

```typescript
async function validate(context, tool, args) {
  return { decision: 'allow' }
}
```

### Deny

Skip tool execution, continue generation:

```typescript
async function validate(context, tool, args) {
  if (tool === 'delete_file') {
    return {
      decision: 'deny',
      extra: { reason: 'File deletion not allowed' }
    }
  }

  return { decision: 'allow' }
}
```

**Behavior:**
- **Streaming**: Emits `LlmChunkTool` with `state: 'canceled'`, continues stream
- **Non-streaming**: Throws error, stops recursion

### Abort

Stop the entire generation:

```typescript
async function validate(context, tool, args) {
  if (args.query?.includes('forbidden')) {
    return {
      decision: 'abort',
      extra: { reason: 'Forbidden query detected' }
    }
  }

  return { decision: 'allow' }
}
```

**Behavior:**
- **Streaming**: Emits `LlmChunkToolAbort`, stops stream immediately
- **Non-streaming**: Throws `LlmChunkToolAbort`, stops recursion

## Decision Matrix

| Decision | Streaming | Non-Streaming |
|----------|-----------|---------------|
| `allow` | Execute tool, continue | Execute tool, continue |
| `deny` | Skip tool, emit canceled chunk, continue | Skip tool, throw error, stop |
| `abort` | Skip tool, emit abort chunk, **stop** | Skip tool, throw abort, stop |

## Use Cases

### Security Policy

```typescript
async function validateToolExecution(context, tool, args) {
  // Block dangerous operations
  const dangerousTools = ['delete_file', 'execute_command', 'modify_system']

  if (dangerousTools.includes(tool)) {
    return {
      decision: 'deny',
      extra: { reason: `Tool ${tool} is not allowed` }
    }
  }

  // Check path safety
  if (tool === 'read_file' && args.path?.includes('..')) {
    return {
      decision: 'deny',
      extra: { reason: 'Invalid path' }
    }
  }

  return { decision: 'allow' }
}
```

### User Confirmation

```typescript
async function validateToolExecution(context, tool, args) {
  // Require confirmation for sensitive operations
  const sensitiveTools = ['send_email', 'make_purchase', 'delete_data']

  if (sensitiveTools.includes(tool)) {
    const confirmed = await askUserConfirmation(
      `Allow ${tool} with ${JSON.stringify(args)}?`
    )

    return {
      decision: confirmed ? 'allow' : 'deny',
      extra: { confirmed }
    }
  }

  return { decision: 'allow' }
}
```

### Rate Limiting

```typescript
const toolCounts = new Map<string, number>()

async function validateToolExecution(context, tool, args) {
  const count = toolCounts.get(tool) || 0

  if (count >= 5) {
    return {
      decision: 'deny',
      extra: { reason: 'Rate limit exceeded' }
    }
  }

  toolCounts.set(tool, count + 1)
  return { decision: 'allow' }
}
```

### Content Filtering

```typescript
async function validateToolExecution(context, tool, args) {
  // Check for forbidden content
  const argsStr = JSON.stringify(args).toLowerCase()

  const forbiddenTerms = ['hack', 'exploit', 'bypass']

  for (const term of forbiddenTerms) {
    if (argsStr.includes(term)) {
      return {
        decision: 'abort',
        extra: { reason: `Forbidden term: ${term}` }
      }
    }
  }

  return { decision: 'allow' }
}
```

### Audit Logging

```typescript
async function validateToolExecution(context, tool, args) {
  // Log all tool usage
  await auditLog({
    timestamp: new Date(),
    modelId: context.modelId,
    tool,
    args
  })

  return { decision: 'allow' }
}
```

## Handling Responses

### With Streaming

```typescript
const stream = model.generate(messages, {
  toolExecutionValidation: validate
})

for await (const chunk of stream) {
  if (chunk.type === 'tool' && chunk.state === 'canceled') {
    // Tool was denied
    console.log('Tool denied:', chunk.name)
    console.log('Status:', chunk.status)
  } else if (chunk.type === 'tool_abort') {
    // Generation aborted
    console.log('Aborted:', chunk.reason)
    break  // Stream stops
  } else if (chunk.type === 'content') {
    console.log('Text:', chunk.text)
  }
}
```

### With Completion

```typescript
try {
  const response = await model.complete(messages, {
    toolExecutionValidation: validate
  })

  console.log(response.content)
} catch (error) {
  if (error.type === 'tool_abort') {
    console.log('Aborted:', error.reason)
  } else {
    console.error('Error:', error)
  }
}
```

## Chunk Types

### LlmChunkTool (Canceled)

When denied:

```typescript
{
  type: 'tool',
  name: 'tool_name',
  state: 'canceled',
  status: 'Tool was denied: [reason]'
}
```

### LlmChunkToolAbort

When aborted:

```typescript
{
  type: 'tool_abort',
  reason: { /* extra data from validation */ }
}
```

## Advanced Examples

### Role-Based Access

```typescript
const userRole = 'viewer'  // from auth system

async function validateToolExecution(context, tool, args) {
  const permissions = {
    admin: ['*'],
    editor: ['read_file', 'write_file', 'search'],
    viewer: ['read_file', 'search']
  }

  const allowed = permissions[userRole] || []

  if (!allowed.includes('*') && !allowed.includes(tool)) {
    return {
      decision: 'deny',
      extra: { reason: `${userRole} cannot use ${tool}` }
    }
  }

  return { decision: 'allow' }
}
```

### Context-Aware Validation

```typescript
async function validateToolExecution(context, tool, args) {
  // Check model-specific rules
  if (context.modelId.includes('gpt-4') && tool === 'execute_code') {
    // Allow code execution for powerful models only
    return { decision: 'allow' }
  }

  // Deny for other models
  if (tool === 'execute_code') {
    return {
      decision: 'deny',
      extra: { reason: 'Code execution requires GPT-4' }
    }
  }

  return { decision: 'allow' }
}
```

### Async Validation

```typescript
async function validateToolExecution(context, tool, args) {
  // Check external API
  const isAllowed = await checkPermissionAPI({
    tool,
    args,
    userId: getCurrentUser()
  })

  if (!isAllowed) {
    return {
      decision: 'deny',
      extra: { reason: 'Permission denied by API' }
    }
  }

  return { decision: 'allow' }
}
```

## Best Practices

1. **Fast validation**: Keep validation quick to avoid delays
2. **Clear reasons**: Provide descriptive reasons for denials
3. **Whitelist approach**: Default to deny, explicitly allow safe tools
4. **Log decisions**: Audit all validation decisions
5. **User feedback**: Show validation status to users
6. **Test edge cases**: Test deny/abort scenarios
7. **Handle async**: Support async validation operations

## Security Considerations

### Input Validation

```typescript
async function validateToolExecution(context, tool, args) {
  // Validate argument types
  if (tool === 'read_file') {
    if (typeof args.path !== 'string') {
      return { decision: 'deny', extra: { reason: 'Invalid path type' } }
    }

    // Check path safety
    if (args.path.includes('..') || args.path.startsWith('/etc')) {
      return { decision: 'deny', extra: { reason: 'Unsafe path' } }
    }
  }

  return { decision: 'allow' }
}
```

### Resource Limits

```typescript
const activeTools = new Set<string>()

async function validateToolExecution(context, tool, args) {
  // Limit concurrent tool executions
  if (activeTools.size >= 3) {
    return {
      decision: 'deny',
      extra: { reason: 'Too many concurrent tools' }
    }
  }

  activeTools.add(tool)

  // Clean up after execution
  setTimeout(() => activeTools.delete(tool), 30000)

  return { decision: 'allow' }
}
```

## Next Steps

- Learn about [Plugins](/guide/plugins) and their execution
- Implement [Abort Operations](/guide/abort) for cancellation
- Review [Function Calling](/guide/function-calling) patterns
