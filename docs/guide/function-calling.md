# Function Calling

Enable models to call functions and use tools during generation.

## Overview

Function calling (also called tool use) allows models to invoke external functions to perform actions or retrieve information. multi-llm-ts handles tool orchestration automatically across all supported providers (OpenAI, Anthropic, Google, Ollama, Groq, Mistral AI, and more).

There are two ways to provide tools to a model: **plugins** and **delegates**.

## Plugins vs Delegates

| | Plugins | Delegates |
|--|---------|-----------|
| **Registration** | Global on engine via `addPlugin()` | Per-request via `toolExecutionDelegate` option |
| **Definition** | Class-based (`Plugin`, `CustomToolPlugin`, `MultiToolPlugin`) | Plain object with `getTools()` and `execute()` |
| **Tool set** | Fixed once registered | Can change on every request |
| **Status updates** | Built-in via `get*Description()` methods | Not supported |
| **Streaming progress** | `executeWithUpdates()` for fine-grained progress | Not supported |
| **Priority** | Higher — checked first when resolving a tool call | Lower — used as fallback |
| **Best for** | Static, well-known tools with rich UX | Dynamic, external, or per-user tools |

Both approaches can be combined: register your core tools as plugins and inject context-specific tools via a delegate on each request. When a plugin and a delegate provide a tool with the same name, the plugin takes priority.

## Using Plugins

Add plugins to your model and they're invoked automatically when needed:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'
import { WeatherPlugin, SearchPlugin } from './plugins'

const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)

// Register tools as plugins
model.addPlugin(new WeatherPlugin())
model.addPlugin(new SearchPlugin())

// Model will call tools as needed
const response = await model.complete([
  new Message('user', 'What is the weather in Paris?')
])

// Behind the scenes:
// 1. Model decides to call get_weather tool
// 2. Plugin executes with parameters {location: "Paris"}
// 3. Result returned to model
// 4. Model generates natural language response
```

See the [Plugins](/guide/plugins) guide for how to create `Plugin`, `CustomToolPlugin`, and `MultiToolPlugin` classes.

## Using Delegates

For dynamic tools that don't need plugin classes, pass a `toolExecutionDelegate` in the options:

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
    const user = await db.users.findByEmail(args.email)
    return { name: user.name, role: user.role }
  }
}

const response = await model.complete(messages, {
  toolExecutionDelegate: delegate
})
```

`getTools()` can also be async — useful when tool definitions are loaded from an API or database. See the [Tool Execution Delegate](/guide/tool-delegate) guide for advanced patterns like per-user tool sets, agent framework integration, and dynamic discovery.

## With Streaming

Tool execution is visible during streaming regardless of which approach you use:

```typescript
const stream = model.generate([
  new Message('user', 'What is the weather in Paris?')
])

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    console.log('Text:', chunk.text)
  } else if (chunk.type === 'tool') {
    console.log(`Tool: ${chunk.name} [${chunk.state}]`)
    console.log(`Status: ${chunk.status}`)
  }
}

// Output:
// Tool: get_weather [preparing]
// Status: Preparing weather lookup...
// Tool: get_weather [running]
// Status: Fetching weather for Paris...
// Tool: get_weather [completed]
// Status: Weather: 18°C, partly cloudy
// Text: The weather in Paris is currently 18°C and partly cloudy.
```

**Tool states:** During streaming, tools emit state updates (`preparing`, `running`, `completed`, `canceled`, `error`). See [Streaming](/guide/streaming#tool-chunks) for details.

## Qwen and DeepSeek text tool formats

OpenAI-compatible servers normally translate a model's native tool syntax into
structured `tool_calls`. Keep the default `toolFormat: 'openai'` when your server
supports this. For endpoints that expose calls as text or models that need tool
instructions in their prompt, the OpenAI SDK-based providers also support:

- `toolFormat: 'hermes'`: Qwen's `<tool_call>{"name": ..., "arguments": ...}</tool_call>` format.
- `toolFormat: 'deepseek'`: DeepSeek-R1's `<｜tool▁calls▁begin｜>` / `<｜tool▁call▁begin｜>` delimiter format, with JSON arguments in a code fence.

These formats are based on the [Qwen3 template](https://huggingface.co/Qwen/Qwen3-8B/blob/main/tokenizer_config.json)
and [DeepSeek-R1 template](https://huggingface.co/deepseek-ai/DeepSeek-R1/blob/main/tokenizer_config.json).
They are opt-in because the required format depends on both the model and its
hosting server. They use Chat Completions, including when Responses API mode is
otherwise configured. The Ollama provider uses its own native tool API and does
not use this option.

```typescript
import { DeepSeek, OpenAI, Message } from 'multi-llm-ts'

const deepseek = new DeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY,
  toolFormat: 'deepseek',
  // Optional: an OpenRouter, Fireworks, or other compatible endpoint.
  // Use that service's API key and model ID when changing baseURL.
  baseURL: 'https://api.deepseek.com/v1',
})

const qwen = new OpenAI({
  apiKey: process.env.QWEN_API_KEY,
  baseURL: 'http://localhost:8000/v1',
  toolFormat: 'hermes',
})

// Register plugins or supply a toolExecutionDelegate as usual.
qwen.addPlugin(new SearchPlugin())
for await (const chunk of qwen.generate('Qwen/Qwen3-8B', [
  new Message('user', 'Search for references to editFile'),
])) {
  // Same content and tool lifecycle chunks as structured tool calls.
}
```

You can also set `toolFormat` per `complete()` / `generate()` request; it overrides
the engine configuration. The adapter places tool schemas and call instructions
in the prompt, parses text calls, and sends results back in the selected format.
It supports plugins, delegates, and tool execution validation. `tools: false`
and `toolChoice: { type: 'none' }` disable parsing; a named `toolChoice` limits the
advertised tools to that function. In text modes, tool choice is a prompt
instruction rather than a server-enforced constraint.

Text outside tool blocks continues to stream. Partial tool blocks are buffered
until their JSON and closing delimiters are complete; malformed or truncated
calls raise an error and are not executed. Calls inside `<think>...</think>` are
not executed, and tool syntax in Markdown code spans or fences remains text.
Structured calls take precedence when an endpoint also returns their text
representation. Streams without a finish reason are finalized at EOF so complete
calls execute and incomplete calls raise an error. Model-specific tool-use quality still depends on the model,
prompt, and hosting service.

## Multi-Turn Conversations with Tool Calls

**Important**: When building multi-turn conversations, track tool calls in message history to maintain proper context.

### Tracking Tool Calls in Streaming

Collect tool calls during streaming and add them to the assistant's message:

```typescript
import { LlmChunkTool } from 'multi-llm-ts'

const conversation = [
  new Message('user', 'What is the weather in Paris and London?')
]

// Collect response and tool calls
const assistantMessage = new Message('assistant', '')
const toolCalls: LlmChunkTool[] = []

const stream = model.generate(conversation)

for await (const chunk of stream) {
  if (chunk.type === 'content') {
    assistantMessage.appendText(chunk)
  } else if (chunk.type === 'tool' && chunk.state === 'completed') {
    // Track completed tool calls
    toolCalls.push(chunk)
  }
}

// Store tool call information in message
if (toolCalls.length > 0) {
  assistantMessage.toolCalls = toolCalls.map(tc => ({
    id: tc.id,
    function: tc.name,
    args: tc.call?.params,
    result: tc.call?.result
  }))
}

// Add to conversation
conversation.push(assistantMessage)

// Continue conversation with context
conversation.push(new Message('user', 'Which one is warmer?'))
const response = await model.complete(conversation)
// Model has access to previous tool calls and can reference them
```

### Why Track Tool Calls?

Tracking tool calls in conversation provides:

1. **Context for follow-up questions**: Model can reference previous tool results
2. **Conversation continuity**: Maintains full history of what information was fetched
3. **Debugging and logging**: Complete audit trail of tool usage
4. **Multi-turn interactions**: Enables complex workflows spanning multiple turns

### Message Structure with Tool Calls

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolCalls: LlmToolCall[]  // Tool calls made by assistant
  attachments: Attachment[]
}

interface LlmToolCall {
  id: string           // Unique call identifier
  function: string     // Tool name
  args: any            // Tool parameters
  result?: any         // Tool result (optional)
}
```

## Complete Example

Full multi-turn conversation with tool tracking:

```typescript
import { igniteModel, loadModels, Message, LlmChunkTool } from 'multi-llm-ts'
import { WeatherPlugin, CalculatorPlugin } from './plugins'

// Setup
const models = await loadModels('openai', config)
const model = igniteModel('openai', models.chat[0], config)
model.addPlugin(new WeatherPlugin())
model.addPlugin(new CalculatorPlugin())

// Start conversation
const conversation = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the weather in Paris?')
]

// Turn 1: Weather query
const assistantMsg1 = new Message('assistant', '')
const toolCalls1: LlmChunkTool[] = []

for await (const chunk of model.generate(conversation)) {
  if (chunk.type === 'content') {
    assistantMsg1.appendText(chunk)
  } else if (chunk.type === 'tool' && chunk.state === 'completed') {
    toolCalls1.push(chunk)
  }
}

if (toolCalls1.length > 0) {
  assistantMsg1.toolCalls = toolCalls1.map(tc => ({
    id: tc.id,
    function: tc.name,
    args: tc.call?.params,
    result: tc.call?.result
  }))
}

conversation.push(assistantMsg1)
console.log(assistantMsg1.content)
// Output: "The weather in Paris is currently 18°C and partly cloudy."

// Turn 2: Follow-up with calculation
conversation.push(new Message('user', 'What is that in Fahrenheit?'))

const response2 = await model.complete(conversation)
console.log(response2.content)
// Model uses previous weather result and calculates: "That's 64.4°F"
```

## Best Practices

1. **Track tool calls**: Always maintain tool call history in multi-turn conversations
2. **Provide clear tool descriptions**: Help models understand when to use each tool
3. **Return structured data**: Use objects with clear field names
4. **Handle errors gracefully**: Let models know what went wrong
5. **Validate inputs**: Check parameters in plugin implementations
6. **Monitor tool usage**: Track which tools are called and how often

## Next Steps

- Create custom [Plugins](/guide/plugins) for your use case
- Use [Tool Execution Delegate](/guide/tool-delegate) for dynamic external tools
- Implement [Tool Validation](/guide/tool-validation) for security
- Learn about [Abort Operations](/guide/abort) for cancellation
- Review [Streaming](/guide/streaming) for real-time updates
