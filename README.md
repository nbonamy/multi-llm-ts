# llm-ts

<img src="https://github.com/nbonamy/multi-llm-ts/actions/workflows/test.yml/badge.svg">

A Typescript library to use LLM providers APIs in a unified way.

Features include:
- Models list
- Chat completion
- Chat streaming
- Text Attachments
- Vision model (image attachments)
- Function calling
- Structured output
- Usage reporting (tokens count)

Check the [demo project](https://github.com/nbonamy/mlts-demo) for a "real" implementation.

## 4.5 Changes

Version 4.5 introduces `LlmModel`, a more elegant abstraction that wraps an engine and a specific model together. This simplifies the API by eliminating the need to pass the model parameter to every `complete()` and `generate()` call.

Use `igniteModel()` instead of `igniteEngine()` to create an `LlmModel` instance. See examples below.

The `LlmEngine` class is still available for backwards compatibility.

<span style="color: red">Breaking Change:</span>
`Plugin::isEnabled` is now true.

## <span style="color: red">4.0 Breaking Changes</span>

Version 4.0 has introduced some breaking changes. Please check section below for details before upgrading.

### model parameter

Prior to 4.0, you could call `LlmEngine.complete` and `LlmGenerate.generate` passing a simple string for the model name. You can still do that and for most providers, this will be enough to get the pre-4.0 behavior. MistralAI and OpenRouter are a bit more convoluted and capababilities cannot be guessed from the model name.

However you can now instead pass a `ChatModel` object which indicates the capabilties of the model. For now, 3 capabilities are supported:
- `tools` (function calling)
- `vision` (image analysis)
- `reasoning` (chain-of-thought models)

Those capabilities are filled when you use the `loadModels` function or . You can also just build a `ChatModel` from a string using `LlmEngine.buildModel` or simply create an instance manually and force the capabilities values.

### attachment

Prior to 4.0, a `user` message could have only one attachment. Now `Message` supports multiple attachments via `attachments` attribute and `attach` and `detach` methods.

### plugins

When executed, plugins are now provided a `PluginExecutionContext` instance providing them information on the context of execution. For now the only information provided is the model id. The `Plugin::execute` method signature is now therefore:

```
async execute(context: PluginExecutionContext , parameters: any): Promise<any>
```

## Providers supported

|Provider|id|Completion<br>&&nbsp;Streaming|Vision|Function calling|Reasoning|Parametrization<sup>1</sup>|Structured Output|Usage reporting|
|---|---|---|---|---|--|--|--|--|
|**Anthropic**|`anthropic`|yes|yes|yes|yes|yes|no|yes|
|**Azure AI**|`azure`|yes|yes|yes|yes|yes|yes|yes|
|**Cerebras**|`cerebras`|yes|no|no|yes|yes|yes|yes|
|**DeepSeek**|`deepseek`|yes|no|yes|yes|yes|no|yes|
|**Google**|`google`|yes|yes|yes|yes|yes|yes<sup>4</sup>|yes|
|**Groq**|`groq`|yes|yes|yes|yes|yes|yes|yes|
|**Meta/Llama**|`meta`|yes|yes|yes|no|yes|no|yes|
|**MistralAI**|`mistralai`|yes|yes|yes|no|yes|yes<sup>4</sup>|yes|
|**Ollama**|`ollama`|yes|yes|yes|yes|yes|yes|yes|
|**OpenAI**|`openai`|yes|yes<sup>2</sup>|yes<sup>2</sup>|yes|yes|yes|yes|
|**OpenRouter**|`openrouter`|yes|yes|yes|no|yes|yes|yes|
|**TogetherAI**<sup>3</sup>|`openai`|yes|yes<sup>2</sup>|yes<sup>2</sup>|no|yes|yes|yes|
|**xAI**|`xai`|yes|yes|yes|no|yes|yes|yes|

<div><sup>1</sup> Max tokens, Temperature... Support varies across providers and models
<div><sup>2</sup> Not supported for o1 family</div>
<div><sup>3</sup> Using `openai` provider. use `https://api.together.xyz/v1` as `baseURL`
<div><sup>4</sup> Provider supports JSON output but does not enforce a specific schema. You need to describe the schema in the user message.

## See it in action

```sh
npm i
API_KEY=your-openai-api-key npm run example
```

You can run it for another provider:

```sh
npm i
API_KEY=your-anthropic_api_key ENGINE=anthropic MODEL=claude-3-haiku-20240307 npm run example
```

## Usage

### Installation

```sh
npm i multi-llm-ts
```

### Loading models

You can download the list of available models for any provider.

```js
const config = { apiKey: 'YOUR_API_KEY' }
const models = await loadModels('PROVIDER_ID', config)
console.log(models.chat)
```

### Chat completion

```js
const config = { apiKey: 'YOUR_API_KEY' }
const models = await loadModels('PROVIDER_ID', config)
const model = igniteModel('PROVIDER_ID', models.chat[0], config)
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
await model.complete(messages)
```

### Chat streaming
```js
const config = { apiKey: 'YOUR_API_KEY' }
const models = await loadModels('PROVIDER_ID', config)
const model = igniteModel('PROVIDER_ID', models.chat[0], config)
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = model.generate(messages)
for await (const chunk of stream) {
  console.log(chunk)
}
```

### Function calling

`multi-llm-ts` will handle call tooling for you. The `tool` chunks you received in the below example are just status update information. You can asnolutely skip them if you don't need them.

```js
const config = { apiKey: 'YOUR_API_KEY' }
const models = await loadModels('PROVIDER_ID', config)
const model = igniteModel('PROVIDER_ID', models.chat[0], config)
model.addPlugin(new MyPlugin())
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = model.generate(messages)
for await (const chunk of stream) {
  // use chunk.type to decide what to do
  // type == 'tool' => tool usage status information
  // type == 'content' => generated text
  console.log(chunk)
}
```

You can easily implement a file reader plugin with a Plugin class such as:

```js

import * as llm from 'multi-llm-ts'

export default class ReadFilePlugin extends llm.Plugin {

  isEnabled(): boolean {
    return true
  }

  getName(): string {
    return "ReadFilePlugin"
  }
  
  getDescription(): string {
    return "A plugin that reads the content of a file given its path."
  }
  
  getPreparationDescription(tool: string): string {
    return `Preparing to read the file at the specified path.`
  }
  
  getRunningDescription(tool: string, args: any): string {
    return `Reading the file located at: ${args.path}`
  }
  
  getCompletedDescription(tool: string, args: any, results: any): string | undefined {
    return `Successfully read the file at: ${args.path}`
  }
  
  getParameters(): llm.PluginParameter[] {
    return [
      {
        name: "path",
        type: "string",
        description: "The path to the file to be read.",
        required: true
      }
    ]
  }
  async execute(context: llm.PluginExecutionContext, parameters: any): Promise<any> {
    const fs = await import('fs/promises')
    const path = parameters.path
    try {
      const content = await fs.readFile(path, 'utf-8')
      return { content }
    } catch (error) {
      console.error(`Error reading file at ${path}:`, error)
      throw new Error(`Failed to read file at ${path}`)
    }
  }

}

```

## Aborting Operations

All `complete()` and `generate()` operations support cancellation via `AbortSignal`:

```js
const abortController = new AbortController()

// Start generation
const stream = model.generate(messages, {
  abortSignal: abortController.signal
})

// Cancel from elsewhere (e.g., user clicks stop button)
setTimeout(() => {
  abortController.abort()
}, 5000)

// Stream will stop and throw AbortError
try {
  for await (const chunk of stream) {
    console.log(chunk)
  }
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Generation was canceled')
  }
}
```

### Plugin Abort Support

Plugins automatically receive the abort signal via `PluginExecutionContext.abortSignal`:

```js
export default class MyPlugin extends llm.Plugin {

  async execute(context: llm.PluginExecutionContext, parameters: any): Promise<any> {

    // Option 1: Use the built-in runWithAbort helper
    const data = await this.runWithAbort(
      fetch('https://api.example.com/data', {
        signal: context.abortSignal
      }),
      context.abortSignal
    )

    // Option 2: Manual checking
    if (context.abortSignal?.aborted) {
      throw new Error('Operation cancelled')
    }

    return processData(data)
  }

}
```

The `runWithAbort()` helper races a promise against the abort signal and provides optional cleanup:

```js
await this.runWithAbort(
  someAsyncOperation(),
  context.abortSignal,
  () => cleanup()  // Optional cleanup callback
)
```

### Tool Execution States

When tools are executed, they emit state information through `LlmChunkTool.state`:

- `'preparing'` - Tool is about to execute
- `'running'` - Tool is currently executing
- `'completed'` - Tool finished successfully
- `'canceled'` - Tool was aborted
- `'error'` - Tool failed with an error

You can customize the status messages for each state:

```js
export default class MyPlugin extends llm.Plugin {

  getPreparationDescription(tool: string): string {
    return 'Initializing search...'
  }

  getRunningDescription(tool: string, args: any): string {
    return `Searching for: ${args.query}`
  }

  getCompletedDescription(tool: string, args: any, results: any): string {
    return `Found ${results.length} results`
  }

  getCanceledDescription(tool: string, args: any): string {
    return 'Search was canceled'
  }

}
```

### Tool Execution Validation

You can control which tools are executed by providing a validation callback. This enables security checks, user confirmations, or policy enforcement before tools run.

```js
const model = igniteModel('PROVIDER_ID', chatModel, config)
model.addPlugin(new MyPlugin())

const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'Search for sensitive information'),
]

// Validation callback to approve/deny/abort tool execution
const validateToolExecution = async (context, tool, args) => {
  // Check if tool should be allowed
  if (tool === 'dangerous_tool') {
    return {
      decision: 'deny',  // Deny execution, continue with error
      extra: { reason: 'Tool not allowed for this user' }
    }
  }

  // Check if we should abort the entire generation
  if (args.query?.includes('forbidden')) {
    return {
      decision: 'abort',  // Abort entire conversation
      extra: { reason: 'Forbidden query detected' }
    }
  }

  // Allow execution
  return { decision: 'allow' }
}

const stream = model.generate(messages, {
  toolExecutionValidation: validateToolExecution
})

for await (const chunk of stream) {
  if (chunk.type === 'tool' && chunk.state === 'canceled') {
    // Tool was denied - execution continued with error result
    console.log('Tool canceled:', chunk.name)
  } else if (chunk.type === 'tool_abort') {
    // Abort was triggered - conversation stopped
    console.log('Conversation aborted:', chunk.reason)
    break  // No more chunks will be emitted
  }
}
```

**Validation Decisions:**

| Decision | Streaming Behavior | Non-Streaming Behavior |
|----------|-------------------|------------------------|
| `'allow'` | Execute tool normally | Execute tool normally |
| `'deny'` | Skip tool, yield `canceled` chunk, continue stream | Skip tool, throw error, stop recursion |
| `'abort'` | Skip tool, yield `tool_abort` chunk, **stop stream** | Skip tool, throw `LlmChunkToolAbort`, stop recursion |

**Chunk Types:**
- `LlmChunkTool` with `state: 'canceled'` - Tool was denied, stream continues
- `LlmChunkToolAbort` - Abort triggered, stream stops immediately

The validation response (including `extra` data) is included in the tool result for denied tools and in the `reason` field for aborted tools.

## OpenAI Responses API

If you prefer to use the OpenAI Responses API, you can do so by:

- setting `EngineCreateOpts.useOpenAIResponsesApi` to true when creating your model
- settings `LlmCompletionOpts.useOpenAIResponsesApi` to true when sumbitting a prompt (completion or streaming)

Not that some models are **not** compatible with the Completions API: the Responses API will automatically be activated for those.

```ts
const model = igniteModel('openai', chatModel, { apiKey: 'KEY', useOpenAIResponsesApi: true })
```

## Tests

`npm run test`

