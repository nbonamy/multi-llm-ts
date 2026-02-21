# Tool Execution Delegate

Execute tools externally without creating plugin classes.

## Overview

The tool execution delegate allows you to:
- Define tools dynamically per request (not globally on the engine)
- Execute tools in your own infrastructure
- Avoid boilerplate plugin wrapper classes
- Integrate multi-llm-ts into existing agent frameworks

This is ideal for:
- Multi-tenant SaaS with per-customer tool sets
- Agent frameworks with their own tool execution layer
- Dynamic tool marketplaces where tools are discovered at runtime
- Role-based tool access control

## Basic Usage

Pass a `toolExecutionDelegate` in the completion options:

```typescript
import { igniteModel, loadModels, Message, ToolExecutionDelegate } from 'multi-llm-ts'

const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

const delegate: ToolExecutionDelegate = {
  getTools() {
    return [
      {
        name: 'lookup_user',
        description: 'Look up a user by email',
        parameters: [
          { name: 'email', type: 'string', description: 'User email', required: true }
        ]
      }
    ]
  },

  async execute(context, tool, args) {
    // Your execution logic
    const user = await db.users.findByEmail(args.email)
    return { name: user.name, role: user.role }
  }
}

const response = await model.complete(messages, {
  toolExecutionDelegate: delegate
})
```

## With Streaming

The delegate works with both `complete()` and `generate()`:

```typescript
const stream = model.generate(messages, {
  toolExecutionDelegate: delegate
})

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    console.log(chunk.text)
  } else if (chunk.type === 'tool') {
    console.log(`Tool: ${chunk.name} [${chunk.state}]`)
  }
}
```

## Async Tool Loading

`getTools()` can return a Promise for tools loaded from external sources:

```typescript
const delegate: ToolExecutionDelegate = {
  async getTools() {
    // Load from API, database, config file, etc.
    const response = await fetch('/api/available-tools')
    return await response.json()
  },

  async execute(context, tool, args) {
    return await myToolRunner.run(tool, args)
  }
}
```

## Combining with Validation

Tool validation applies to delegate tools as well. The validation callback runs before the delegate's `execute()`:

```typescript
const response = await model.complete(messages, {
  toolExecutionDelegate: delegate,
  toolExecutionValidation: async (context, tool, args) => {
    // This gates both plugin AND delegate tools
    if (blockedTools.includes(tool)) {
      return { decision: 'deny' }
    }
    return { decision: 'allow' }
  }
})
```

## Use Cases

### Per-User Tool Sets

```typescript
async function handleUserRequest(userId: string, messages: Message[]) {
  const userTools = await loadToolsForUser(userId)

  const delegate: ToolExecutionDelegate = {
    getTools: () => userTools.definitions,
    execute: (ctx, tool, args) => userTools.execute(tool, args)
  }

  return await model.complete(messages, {
    toolExecutionDelegate: delegate
  })
}
```

### Agent Framework Integration

```typescript
class MyAgentFramework implements ToolExecutionDelegate {
  getTools() {
    return this.registry.listTools()
  }

  async execute(context, tool, args) {
    // Route through your framework's execution pipeline
    const result = await this.pipeline.execute({
      tool,
      args,
      model: context.model,
      signal: context.abortSignal,
    })
    return result
  }
}

const agent = new MyAgentFramework()
const stream = model.generate(messages, {
  toolExecutionDelegate: agent
})
```

### Dynamic Tool Discovery

```typescript
const delegate: ToolExecutionDelegate = {
  async getTools() {
    // Discover tools from a registry
    const tools = await toolRegistry.discover({
      tags: ['production', 'safe'],
      version: 'latest'
    })
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.schema.parameters
    }))
  },

  async execute(context, tool, args) {
    return await toolRegistry.invoke(tool, args)
  }
}
```

## ToolExecutionDelegate Type

```typescript
type ToolExecutionDelegate = {
  getTools(): Promise<PluginTool[]> | PluginTool[]
  execute(
    context: PluginExecutionContext,
    tool: string,
    args: any
  ): Promise<any>
}
```

**`getTools()`**: Returns tool definitions. Called when building the tool list for the LLM. Can be sync or async.

**`execute(context, tool, args)`**: Called when the model invokes a delegate tool.
- `context`: Execution context with `model` (model ID) and optional `abortSignal`
- `tool`: Name of the tool being called
- `args`: Parsed arguments from the model

## Next Steps

- Learn about [Plugins](/guide/plugins) for static tool registration
- Implement [Tool Validation](/guide/tool-validation) for security
- Review [Function Calling](/guide/function-calling) patterns
