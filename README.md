# llm-ts

A Typescript library to use LLM providers APIs in a unified way.

Features include:
- Models list
- Chat completion
- Chat streaming
- Text Attachments
- Vision model (image attachments)
- Function calling
- Usage reporting (tokens count)

## Providers supported

Not all providers support a "get models" end point. Those who do are listed as `dynamic` in the table below. For those who are listed as `static`, the list of models is hardcoded.

|Provider|id|Models|Completion|Streaming|Vision|Function calling|Usage reporting|
|---|---|---|---|---|---|--|--|
|**Anthropic**|`anthropic`|static|yes|yes|yes|yes|yes|
|**Cerebras**|`cerebras`|static|yes|yes|no|no|yes|
|**DeepSeek**|`deepseek`|static|yes|yes|no|yes|yes|
|**Google**|`google`|static|yes|yes|yes|yes|yes|
|**Groq**|`groq`|static|yes|yes|yes|yes|yes|
|**MistralAI**|`mistralai`|dynamic|yes|yes|yes|yes|yes|
|**Ollama**|`ollama`|dynamic|yes|yes|yes|yes|yes|
|**OpenAI**|`openai`|dynamic|yes|yes|yes<sup>1</sup>|yes<sup>1</sup>|yes|
|**TogetherAI**<sup>2</sup>|`openai`|dynamic|yes|yes|yes<sup>1</sup>|yes<sup>1</sup>|yes|
|**xAI**|`xai`|static|yes|yes|yes|yes|yes|

<div><sup>1</sup> not supported for o1 family</div>
<div><sup>2</sup> using `openai` provider. use `https://api.together.xyz/v1` as `baseURL`

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
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
await llm.complete('MODEL_ID', messages)
```

### Chat streaming
```js
const llm = igniteEngine('PROVIDER_ID', { apiKey: 'YOUR_API_KEY' })
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = llm.generate('MODEL_ID', messages)
for await (const chunk of stream) {
  console.log(chunk)
}
```

### Function calling

```js
const llm = igniteEngine('PROVIDER_ID', { apiKey: 'YOUR_API_KEY' })
llm.addPlugin(new MyPlugin())
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
]
const stream = llm.generate('MODEL_ID', messages)
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

