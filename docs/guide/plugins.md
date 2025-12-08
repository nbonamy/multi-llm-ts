# Plugins

Create custom tools and functions that models can invoke during generation.

## What are Plugins?

Plugins are the mechanism for exposing tools to models in multi-llm-ts. A plugin represents one or more tools that a model can call during generation, with built-in support for status updates and progress tracking.

**Key concept:** Plugins provide an internal mechanism for status updates via `get*Description()` methods, allowing real-time feedback during tool execution.

## Plugin Types

multi-llm-ts provides three plugin base classes:

### Plugin (Standard)

**One plugin = One tool**

The base `Plugin` class is used when you want to create a single tool with full control over its definition:

```typescript
import { Plugin, PluginParameter, PluginExecutionContext } from 'multi-llm-ts'

export class WeatherPlugin extends Plugin {

  getName(): string {
    return 'get_weather'
  }

  getDescription(): string {
    return 'Get current weather for a location'
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'location',
        type: 'string',
        description: 'City name',
        required: true
      }
    ]
  }

  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    const weather = await fetchWeather(parameters.location)
    return {
      temperature: weather.temp,
      condition: weather.condition
    }
  }
}
```

**Use when:** You need a single tool with standard parameter definition.

### CustomToolPlugin

**One plugin = One tool (custom definition)**

Extends `Plugin` to let you build the tool description manually, bypassing the parameter system:

```typescript
import { CustomToolPlugin, PluginExecutionContext } from 'multi-llm-ts'

export class MyCustomPlugin extends CustomToolPlugin {

  getName(): string {
    return 'my_tool'
  }

  getDescription(): string {
    return 'My custom tool'
  }

  async getTools(): Promise<any> {
    // Return tool in OpenAI format
    return {
      type: 'function',
      function: {
        name: 'my_tool',
        description: 'Custom tool description',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            }
          },
          required: ['query']
        }
      }
    }
  }

  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    // Implementation
    return await performSearch(parameters.query)
  }
}
```

**Use when:** You need fine-grained control over the tool definition or want to use advanced parameter schemas.

### MultiToolPlugin

**One plugin = Multiple tools**

Extends `CustomToolPlugin` to provide multiple tools from a single plugin. Think of this like an MCP server that provides several related tools:

```typescript
import { MultiToolPlugin, PluginExecutionContext } from 'multi-llm-ts'

export class FileSystemPlugin extends MultiToolPlugin {

  getName(): string {
    return 'filesystem'
  }

  getDescription(): string {
    return 'File system operations'
  }

  async getTools(): Promise<any[]> {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write file contents',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
              content: { type: 'string', description: 'File content' }
            },
            required: ['path', 'content']
          }
        }
      }
    ]
  }

  handlesTool(name: string): boolean {
    return name === 'read_file' || name === 'write_file'
  }

  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    const { tool, parameters: params } = parameters

    if (tool === 'read_file') {
      return await fs.readFile(params.path, 'utf-8')
    } else if (tool === 'write_file') {
      await fs.writeFile(params.path, params.content)
      return { success: true }
    }
  }
}
```

**Tool Selection:** MultiToolPlugin supports selective tool enabling:

```typescript
const plugin = new FileSystemPlugin()

// Enable specific tools only
plugin.enableTool('read_file')

// In getTools() and handlesTool(), check this.toolsEnabled
handlesTool(name: string): boolean {
  const handled = name === 'read_file' || name === 'write_file'
  return handled && (!this.toolsEnabled || this.toolsEnabled.includes(name))
}
```

**Use when:** You want to provide a suite of related tools, similar to an MCP server.

## Status Updates

All plugin types support status description methods that provide real-time feedback during execution:

### Status Description Methods

```typescript
export class MyPlugin extends Plugin {

  // Called when tool is about to execute
  getPreparationDescription(tool: string): string {
    return 'Preparing to search...'
  }

  // Called during execution (shown with running state)
  getRunningDescription(tool: string, args: any): string {
    return `Searching for "${args.query}"...`
  }

  // Called after successful execution
  getCompletedDescription(tool: string, args: any, result: any): string {
    return `Found ${result.count} results for "${args.query}"`
  }

  // Called if validation denies execution
  getCanceledDescription(tool: string, args: any): string {
    return `Search for "${args.query}" was cancelled`
  }
}
```

Status updates are emitted as `tool` chunks during streaming. With `complete()`, status descriptions are used internally but not visible to the caller:

```typescript
for await (const chunk of model.generate(messages)) {
  if (chunk.type === 'tool') {
    console.log(chunk.status)  // From getRunningDescription()
    console.log(chunk.state)   // 'preparing' | 'running' | 'completed' | 'canceled'
  }
}
```

## Fine-Grained Progress with executeWithUpdates

For long-running operations, implement `executeWithUpdates()` to provide granular progress updates:

### Basic Usage

```typescript
export class BatchPlugin extends Plugin {

  // Standard execution for complete()
  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    const results = []
    for (const item of parameters.items) {
      results.push(await processItem(item))
    }
    return results
  }

  // Fine-grained execution for streaming
  async *executeWithUpdates(
    context: PluginExecutionContext,
    parameters: any
  ): AsyncGenerator<PluginExecutionUpdate> {

    const items = parameters.items
    const results = []

    for (let i = 0; i < items.length; i++) {
      // Check for abort
      if (context.abortSignal?.aborted) {
        yield {
          type: 'result',
          result: { error: 'Operation cancelled' },
          canceled: true
        }
        return
      }

      // Emit progress status
      yield {
        type: 'status',
        status: `Processing item ${i + 1}/${items.length}...`
      }

      // Do work
      const result = await processItem(items[i])
      results.push(result)
    }

    // Emit final result
    yield {
      type: 'result',
      result: results
    }
  }
}
```

**Streaming with Progress Updates:**

```typescript
model.addPlugin(new BatchPlugin())

const stream = model.generate(messages)

for await (const chunk of stream) {
  if (chunk.type === 'tool') {
    console.log(`[${chunk.state}] ${chunk.status}`)
    // Output:
    // [running] Processing item 1/10...
    // [running] Processing item 2/10...
    // [running] Processing item 3/10...
    // [completed] Completed batch processing
  }
}
```

**When to use:**
- Processing multiple items (batch operations)
- Long-running operations with progress milestones
- Multi-step workflows
- Any operation where users benefit from progress feedback

**How it works:**
- If `executeWithUpdates()` exists, the engine uses it during streaming
- Otherwise, falls back to `execute()`
- `complete()` always uses `execute()`, not `executeWithUpdates()`

## Using Plugins

```typescript
import { igniteModel, loadModels } from 'multi-llm-ts'
import { WeatherPlugin, SearchPlugin, FileSystemPlugin } from './plugins'

const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

// Add single-tool plugins
model.addPlugin(new WeatherPlugin())
model.addPlugin(new SearchPlugin())

// Add multi-tool plugin
const fsPlugin = new FileSystemPlugin()
fsPlugin.enableTool('read_file')  // Only enable read
model.addPlugin(fsPlugin)

// Model can now call these tools
const response = await model.complete([
  new Message('user', 'What is the weather in Paris?')
])
```

## Best Practices

1. **Choose the right plugin type:**
   - `Plugin` for simple single tools
   - `CustomToolPlugin` for custom tool schemas
   - `MultiToolPlugin` for related tool suites

2. **Provide meaningful status updates:**
   - Make status messages user-friendly and include relevant details
   - Use `executeWithUpdates()` for operations taking >2 seconds or with progress milestones

3. **Handle abort signals:**
   - Check `context.abortSignal?.aborted` in loops
   - Use `runWithAbort()` for async operations

## Next Steps

- Learn about [Function Calling](/guide/function-calling) to see plugins in action
- Implement [Tool Validation](/guide/tool-validation) for security
- Handle [Abort Operations](/guide/abort) properly
- Review [Plugin API](/api/plugin) for complete reference
