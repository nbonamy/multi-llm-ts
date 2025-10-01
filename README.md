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
|**Cerebras**|`cerebras`|yes|no|no|no|yes|yes|yes|
|**DeepSeek**|`deepseek`|yes|no|yes|yes|yes|no|yes|
|**Google**|`google`|yes|yes|yes|yes|yes|yes<sup>4</sup>|yes|
|**Groq**|`groq`|yes|yes|yes|no|yes|yes|yes|
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

