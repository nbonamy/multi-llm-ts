# Message

Message class for conversation management.

## Overview

The `Message` class represents a single message in a conversation with support for multiple attachments.

```typescript
import { Message } from 'multi-llm-ts'

const message = new Message('user', 'Hello, world!')
```

See the [Messages Guide](/guide/messages) for detailed usage.

## Constructor

```typescript
new Message(role: string, content: string)
```

**Parameters:**
- `role`: Message role (`'system'`, `'user'`, `'assistant'`)
- `content`: Message text content

**Example:**
```typescript
const system = new Message('system', 'You are helpful')
const user = new Message('user', 'What is TypeScript?')
const assistant = new Message('assistant', 'TypeScript is...')
```

## Properties

### role

Message role:

```typescript
message.role: 'system' | 'user' | 'assistant'
```

### content

Message text content:

```typescript
message.content: string
```

### attachments

Array of attachments:

```typescript
message.attachments: Attachment[]
```

### transient

Exclude from conversation history:

```typescript
message.transient?: boolean
```

## Methods

### attach()

Add an attachment:

```typescript
attach(attachment: Attachment): void
```

**Example:**
```typescript
message.attach({
  url: '/path/to/image.jpg',
  mimeType: 'image/jpeg'
})
```

### detach()

Remove an attachment:

```typescript
detach(attachment: Attachment): void
```

**Example:**
```typescript
message.detach(attachment)
```

### setContent()

Update message content:

```typescript
setContent(content: string): void
```

**Example:**
```typescript
message.setContent('Updated text')
```

### appendText()

Append text to content:

```typescript
appendText(text: string): void
```

**Example:**
```typescript
message.appendText(' Additional text.')
```

## Attachment

Attachment object structure:

```typescript
interface Attachment {
  url: string           // File path or URL
  mimeType: string      // MIME type
  downloaded?: boolean  // Auto-populated
  content?: string      // Base64 content (auto-populated)
}
```

### Supported MIME Types

**Images:**
- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`

**Text:**
- `text/plain`
- `text/html`
- `text/markdown`

**Other:**
- `application/pdf`
- Provider-specific types

## Examples

### Basic Message

```typescript
const message = new Message('user', 'Hello!')
```

### System Message

```typescript
const system = new Message('system', 'You are a helpful coding assistant')
```

### Message with Image

```typescript
const message = new Message('user', 'Describe this image')
message.attach({
  url: 'photo.jpg',
  mimeType: 'image/jpeg'
})
```

### Multiple Attachments

```typescript
const message = new Message('user', 'Compare these images')
message.attach({ url: 'image1.jpg', mimeType: 'image/jpeg' })
message.attach({ url: 'image2.png', mimeType: 'image/png' })
```

### Transient Message

```typescript
const message = new Message('user', 'One-time instruction')
message.transient = true
```

### Modifying Content

```typescript
const message = new Message('user', 'Hello')
message.appendText(' World')
message.setContent('Hello Universe')
```

## Conversation Building

### Single Turn

```typescript
const messages = [
  new Message('system', 'You are helpful'),
  new Message('user', 'What is JavaScript?')
]

const response = await model.complete(messages)
```

### Multi-Turn

```typescript
const conversation = [
  new Message('system', 'You are helpful')
]

// Turn 1
conversation.push(new Message('user', 'Tell me about TypeScript'))
const response1 = await model.complete(conversation)
conversation.push(new Message('assistant', response1.content))

// Turn 2
conversation.push(new Message('user', 'How do I use interfaces?'))
const response2 = await model.complete(conversation)
```

### With Vision

```typescript
const message = new Message('user', 'Analyze this code screenshot')
message.attach({
  url: 'code_screenshot.png',
  mimeType: 'image/png'
})

const response = await model.complete([message])
```

## Role Types

### System

Instructions and context for the model:

```typescript
new Message('system', 'You are a helpful assistant specializing in...')
```

**Best practices:**
- Place first in conversation
- Keep concise
- Define personality and constraints

### User

User input and prompts:

```typescript
new Message('user', 'What is the capital of France?')
```

### Assistant

Model responses in multi-turn conversations:

```typescript
new Message('assistant', 'The capital of France is Paris.')
```

## Attachment Loading

Attachments are loaded automatically:

```typescript
const message = new Message('user', 'Read this file')
message.attach({
  url: '/local/document.txt',
  mimeType: 'text/plain'
})

// File is read and base64-encoded during generation
await model.complete([message])
```

## Transient Messages

Messages marked as transient are excluded from history:

```typescript
const instruction = new Message('user', 'Use simple language')
instruction.transient = true

const messages = [
  new Message('system', 'You are helpful'),
  instruction,  // Won't persist in conversation
  new Message('user', 'Explain quantum physics')
]
```

## Next Steps

- Learn about [Messages](/guide/messages) usage
- See [Vision](/guide/vision) for image attachments
- Review [Completion](/guide/completion) for generation
