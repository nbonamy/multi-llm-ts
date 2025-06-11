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
- Usage reporting (tokens count)

## <span style="color: red">4.0 Breaking Changes</span>

Version 4.0 has introduced some breaking changes. Please check section below for details before upgrading.

### model parameter

Prior to 4.0, you could call `LlmEngine.complete` and `LlmGenerate.generate` passing a simple string for the model name. This is not possible anymore: those methods require a `ChatModel` object which indicates the capabilties of the model. For now, 3 capabilities are supported:
- `tools` (function calling)
- `vision` (image analysis)
- `reasoning` (chain-of-thought models)

Those capabilities are filled when you use the `loadModels` function. You can also just build a `ChatModel` from a string using `LlmEngine.buildModel`. For most providers, this will be enough to get the pre-4.0 behavior. MistralAI and OpenRouter are a bit more convoluted and all three capabilities will be disabled when using `LlmEngine.buildModel`.

### attachment

Prior to 4.0, a `user` message could have only one attachment. Now `Message` supports multiple attachments via `attachments` attribute and `attach` and `detach` methods.


## Providers supported

|Provider|id|Completion<br>&&nbsp;Streaming|Vision|Function calling|Reasoning|Parametrization<sup>1</sup>|Usage reporting|
|---|---|---|---|---|--|--|--|
|**Anthropic**|`anthropic`|yes|yes|yes|yes|yes|yes|
|**Azure AI**|`azure`|yes|yes|yes|yes|yes|yes|
|**Cerebras**|`cerebras`|yes|no|no|no|yes|yes|
|**DeepSeek**|`deepseek`|yes|no|yes|yes|yes|yes|
|**Google**|`google`|yes|yes|yes|no|yes|yes|
|**Groq**|`groq`|yes|yes|yes|no|yes|yes|
|**Meta/Llama**|`meta`|yes|yes|yes|no|yes|yes|
|**MistralAI**|`mistralai`|yes|yes|yes|no|yes|yes|
|**Ollama**|`ollama`|yes|yes|yes|yes|yes|yes|
|**OpenAI**|`openai`|yes|yes<sup>2</sup>|yes<sup>2</sup>|yes|yes|yes|
|**OpenRouter**|`openrouter`|yes|yes|yes|no|yes|yes|
|**TogetherAI**<sup>3</sup>|`openai`|yes|yes<sup>2</sup>|yes<sup>2</sup>|no|yes|yes|
|**xAI**|`xai`|yes|yes|yes|no|yes|yes|
|**LM Studio**|`lmstudio`|yes|yes|yes|yes|yes|yes|

<div><sup>1</sup> Max tokens, Temperature... Support varies across providers and models
<div><sup>2</sup> Not supported for o1 family</div>
<div><sup>3</sup> Using `openai` provider. use `https://api.together.xyz/v1` as `baseURL`

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
const llm = igniteEngine('PROVIDER_ID', { apiKey: 'YOUR_API_KEY' })
const models = await loadModels('PROVIDER_ID', config)
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
await llm.complete(models.chat[0], messages)
```

### Chat streaming
```js
const llm = igniteEngine('PROVIDER_ID', { apiKey: 'YOUR_API_KEY' })
const models = await loadModels('PROVIDER_ID', config)
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = llm.generate(models.chat[0], messages)
for await (const chunk of stream) {
  console.log(chunk)
}
```

### Function calling

```js
const llm = igniteEngine('PROVIDER_ID', { apiKey: 'YOUR_API_KEY' })
const models = await loadModels('PROVIDER_ID', config)
llm.addPlugin(new MyPlugin())
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = llm.generate(models.chat[0], messages)
for await (const chunk of stream) {
  // use chunk.type to decide what to do
  // type == 'tool' => tool usage status information
  // type == 'content' => generated text
  console.log(chunk)
}
```

You can easily implement Image generation using DALL-E with a Plugin class such as:

```js
export default class extends Plugin {

  constructor(config: PluginConfig) {
    super(config)
  }

  isEnabled(): boolean {
    return config?.apiKey != null
  }

  getName(): string {
    return 'dalle_image_generation'
  }

  getDescription(): string {
    return 'Generate an image based on a prompt. Returns the path of the image saved on disk and a description of the image.'
  }

  getPreparationDescription(): string {
    return this.getRunningDescription()
  }
      
  getRunningDescription(): string {
    return 'Painting pixels…'
  }

  getParameters(): PluginParameter[] {

    const parameters: PluginParameter[] = [
      {
        name: 'prompt',
        type: 'string',
        description: 'The description of the image',
        required: true
      }
    ]

    // rest depends on model
    if (store.config.engines.openai.model.image === 'dall-e-2') {

      parameters.push({
        name: 'size',
        type: 'string',
        enum: [ '256x256', '512x512', '1024x1024' ],
        description: 'The size of the image',
        required: false
      })

    } else if (store.config.engines.openai.model.image === 'dall-e-3') {

      parameters.push({
        name: 'quality',
        type: 'string',
        enum: [ 'standard', 'hd' ],
        description: 'The quality of the image',
        required: false
      })

      parameters.push({
        name: 'size',
        type: 'string',
        enum: [ '1024x1024', '1792x1024', '1024x1792' ],
        description: 'The size of the image',
        required: false
      })

      parameters.push({
        name: 'style',
        type: 'string',
        enum: ['vivid', 'natural'],
        description: 'The style of the image',
        required: false
      })

    }

    // done
    return parameters
  
  }

   
  async execute(parameters: any): Promise<any> {

    // init
    const client = new OpenAI({
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true
    })

    // call
    console.log(`[openai] prompting model ${model}`)
    const response = await client.images.generate({
      model: 'dall-e-2',
      prompt: parameters?.prompt,
      response_format: 'b64_json',
      size: parameters?.size,
      style: parameters?.style,
      quality: parameters?.quality,
      n: parameters?.n || 1,
    })

    // return an object
    return {
      path: fileUrl,
      description: parameters?.prompt
    }

  }  

}
```

## Tests

`npm run test`

