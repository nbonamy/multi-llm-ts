# Vision

Analyze images with vision-capable models.

## Overview

Vision models can understand and describe images, extract text, identify objects, and answer questions about visual content.

**Supported providers**: OpenAI, Anthropic, Google, Groq, Ollama, and more.

## Basic Usage

Attach an image to a message:

```typescript
import { igniteModel, loadModels, Message } from 'multi-llm-ts'

const config = { apiKey: process.env.OPENAI_API_KEY }
const models = await loadModels('openai', config)

// Find a vision-capable model
const visionModel = models.chat.find(m => m.capabilities?.vision)
const model = igniteModel('openai', visionModel, config)

// Create message with image
const message = new Message('user', 'What is in this image?')
message.attach({
  url: '/path/to/image.jpg',
  mimeType: 'image/jpeg'
})

const response = await model.complete([message])
console.log(response.content)
```

## Supported Image Formats

Most providers support:
- **JPEG** (`.jpg`, `.jpeg`)
- **PNG** (`.png`)
- **WebP** (`.webp`)
- **GIF** (`.gif`) - usually non-animated

Check your provider's documentation for specific support.

## Attaching Images

### Local Files

```typescript
const message = new Message('user', 'Describe this image')
message.attach({
  url: '/Users/username/photos/image.jpg',
  mimeType: 'image/jpeg'
})
```

### Multiple Images

```typescript
const message = new Message('user', 'Compare these images')
message.attach({ url: 'image1.jpg', mimeType: 'image/jpeg' })
message.attach({ url: 'image2.jpg', mimeType: 'image/jpeg' })
```

### Remote URLs

Some providers support remote URLs:

```typescript
message.attach({
  url: 'https://example.com/image.jpg',
  mimeType: 'image/jpeg'
})
```

**Note**: Not all providers support remote URLs. Local files are more reliable.

## Use Cases

### Image Description

```typescript
const message = new Message('user', 'Describe this image in detail')
message.attach({ url: 'photo.jpg', mimeType: 'image/jpeg' })

const response = await model.complete([message])
// "The image shows a sunset over mountains with orange and purple hues..."
```

### Text Extraction (OCR)

```typescript
const message = new Message('user', 'Extract all text from this image')
message.attach({ url: 'document.jpg', mimeType: 'image/jpeg' })

const response = await model.complete([message])
// Extracted text content
```

**Other common use cases:** object detection, image comparison, visual question answering, code generation from screenshots, chart analysis.

## With Structured Output

Combine vision with structured output:

```typescript
import { z } from 'zod'

const schema = z.object({
  objects: z.array(z.object({
    name: z.string(),
    count: z.number(),
    color: z.string()
  })),
  scene: z.string()
})

const message = new Message('user', 'Analyze this image')
message.attach({ url: 'image.jpg', mimeType: 'image/jpeg' })

const response = await model.complete([message], { schema })
const analysis = JSON.parse(response.content)
```

## Multi-Turn with Vision

Images can be part of conversations:

```typescript
const conversation = []

// Turn 1: Analyze image
const msg1 = new Message('user', 'What is in this image?')
msg1.attach({ url: 'photo.jpg', mimeType: 'image/jpeg' })
conversation.push(msg1)

const response1 = await model.complete(conversation)
conversation.push(new Message('assistant', response1.content))

// Turn 2: Ask follow-up (image context retained)
conversation.push(new Message('user', 'What color is the car?'))

const response2 = await model.complete(conversation)
```

## Image Loading

Images are automatically loaded and base64-encoded:

```typescript
const message = new Message('user', 'Describe this')
message.attach({ url: '/local/file.jpg', mimeType: 'image/jpeg' })

// File is read automatically during generation
await model.complete([message])
```

## Attachment Object

```typescript
interface Attachment {
  url: string           // File path or URL
  mimeType: string      // MIME type (e.g., 'image/jpeg')
  downloaded?: boolean  // Auto-populated
  content?: string      // Base64 content (auto-populated)
}
```

## Provider Capabilities

Check if a model supports vision:

```typescript
const models = await loadModels('openai', config)

// Filter vision models
const visionModels = models.chat.filter(m => m.capabilities?.vision)

// Check specific model
if (chatModel.capabilities?.vision) {
  // Use vision features
}
```

## Next Steps

- Learn about [Messages](/guide/messages) and attachments
- Combine with [Structured Output](/guide/structured-output)
- Use with [Function Calling](/guide/function-calling)
