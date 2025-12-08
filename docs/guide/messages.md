# Messages

Messages are the building blocks of conversations with LLMs.

## Message Class

The `Message` class represents a single message in a conversation:

```typescript
import { Message } from 'multi-llm-ts'

const message = new Message('user', 'Hello, world!')
```

**Constructor:**
```typescript
new Message(role: string, content: string)
```

**Roles:**
- `'system'` - System instructions that guide model behavior
- `'user'` - Messages from the user
- `'assistant'` - Messages from the AI model

## System Messages

System messages set the context and behavior for the conversation:

```typescript
const systemMsg = new Message('system', 'You are a helpful coding assistant')
```

## User Messages

User messages contain the prompts or questions:

```typescript
const userMsg = new Message('user', 'Write a function to calculate fibonacci')
```

## Assistant Messages

Assistant messages represent previous AI responses in multi-turn conversations:

```typescript
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'What is the capital of France?'),
  new Message('assistant', 'The capital of France is Paris.'),
  new Message('user', 'What is its population?')
]
```

## Attachments

Messages support multiple attachments for images, documents, and other content.

### Adding Attachments

```typescript
const message = new Message('user', 'What is in this image?')

// Add a single attachment
message.attach({
  url: '/path/to/image.jpg',
  mimeType: 'image/jpeg'
})

// Add multiple attachments
message.attach({ url: 'image1.jpg', mimeType: 'image/jpeg' })
message.attach({ url: 'image2.png', mimeType: 'image/png' })
```

### Attachment Object

```typescript
interface Attachment {
  url: string       // File path or URL
  mimeType: string  // MIME type (e.g., 'image/jpeg', 'text/plain')
  downloaded?: boolean
  content?: string  // Base64-encoded content (auto-populated)
}
```

### Removing Attachments

```typescript
// Remove specific attachment
message.detach(attachment)

// Access all attachments
console.log(message.attachments)
```

### Supported Attachment Types

#### Images (Vision Models)

Attach images for vision-capable models. See the [Vision guide](/guide/vision) for supported formats and detailed usage.

#### Text Files

```typescript
message.attach({ url: 'document.txt', mimeType: 'text/plain' })
message.attach({ url: 'code.py', mimeType: 'text/x-python' })
```

Some providers support text attachments for RAG-like functionality.

### Attachment Loading

Attachments are automatically loaded when needed:

```typescript
const message = new Message('user', 'Analyze this image')
message.attach({ url: '/local/file.jpg', mimeType: 'image/jpeg' })

// File is read and base64-encoded automatically during generation
await model.complete([message])
```

## Message Structure

Internally, messages have this structure:

```typescript
interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  attachments: Attachment[]

  // Methods
  attach(attachment: Attachment): void
  detach(attachment: Attachment): void
  setContent(content: string): void
  appendText(text: string): void
  transient?: boolean  // Exclude from conversation history
}
```

## Transient Messages

Mark messages as transient to exclude them from conversation history:

```typescript
const message = new Message('user', 'One-time instruction')
message.transient = true
```

Useful for:
- One-off instructions
- Dynamic system prompts
- Context that shouldn't persist

## Building Conversations

Multi-turn conversations maintain context:

```typescript
const conversation = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'Tell me about TypeScript'),
  new Message('assistant', 'TypeScript is a typed superset of JavaScript...'),
  new Message('user', 'How do I define an interface?')
]

const response = await model.complete(conversation)
```

After each response:

```typescript
// Add assistant response to conversation
conversation.push(new Message('assistant', response.content))

// Add next user message
conversation.push(new Message('user', 'Next question'))
```

## Examples

### Basic Chat

```typescript
const messages = [
  new Message('system', 'You are a helpful assistant'),
  new Message('user', 'Hello!')
]
const response = await model.complete(messages)
```

### Vision Analysis

```typescript
const message = new Message('user', 'Describe this image in detail')
message.attach({ url: 'photo.jpg', mimeType: 'image/jpeg' })

const response = await model.complete([message])
```

### Multi-Turn with Context

```typescript
const conversation = []

// Turn 1
conversation.push(new Message('user', 'My name is Alice'))
let response = await model.complete(conversation)
conversation.push(new Message('assistant', response.content))

// Turn 2
conversation.push(new Message('user', 'What is my name?'))
response = await model.complete(conversation)
// Response: "Your name is Alice."
```

## Next Steps

- Learn about [Completion](/guide/completion) to generate responses
- Explore [Streaming](/guide/streaming) for real-time output
- Try [Vision](/guide/vision) for image analysis
