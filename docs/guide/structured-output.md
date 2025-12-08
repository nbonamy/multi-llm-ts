# Structured Output

Generate and validate JSON responses using Zod schemas.

## Overview

Structured output ensures models return JSON in a specific format validated against a schema. This is essential for:
- Data extraction
- API responses
- Form filling
- Structured data generation

## Basic Usage

Define a Zod schema and pass it to `complete()`:

```typescript
import { z } from 'zod'
import { igniteModel, Message } from 'multi-llm-ts'

const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().email()
})

const model = igniteModel('openai', chatModel, config)

const messages = [
  new Message('user', 'Extract: John Doe, 30 years old, john@example.com')
]

const response = await model.complete(messages, { schema })

const data = JSON.parse(response.content)
// data: { name: "John Doe", age: 30, email: "john@example.com" }
```

## Provider Support

| Provider | Support | Schema Enforcement |
|----------|---------|-------------------|
| OpenAI | ✅ | Strict |
| Anthropic | ❌ | - |
| Google | ⚠️ | Prompt-based |
| Groq | ✅ | Strict |
| Azure AI | ✅ | Strict |
| Cerebras | ✅ | Strict |
| Ollama | ✅ | Strict |
| MistralAI | ⚠️ | Prompt-based |
| OpenRouter | ✅ | Varies by model |
| Others | ⚠️ | Varies |

**Legend:**
- ✅ **Strict**: Schema is enforced by API
- ⚠️ **Prompt-based**: Schema described in prompt only
- ❌ **Not supported**: No structured output support

## Schema Definition

### Simple Objects

```typescript
const schema = z.object({
  title: z.string(),
  count: z.number(),
  active: z.boolean()
})
```

### Nested Objects

```typescript
const schema = z.object({
  user: z.object({
    name: z.string(),
    age: z.number()
  }),
  address: z.object({
    street: z.string(),
    city: z.string()
  })
})
```

### Arrays

```typescript
const schema = z.object({
  items: z.array(z.string()),
  scores: z.array(z.number())
})
```

### Complex Schemas

```typescript
const schema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
      inStock: z.boolean(),
      tags: z.array(z.string())
    })
  ),
  totalCount: z.number()
})
```

### Optional Fields

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number().optional(),
  email: z.string().optional()
})
```

### Enums

```typescript
const schema = z.object({
  status: z.enum(['pending', 'active', 'completed']),
  priority: z.enum(['low', 'medium', 'high'])
})
```

### Descriptions

Add descriptions to help the model:

```typescript
const schema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().describe('Age in years'),
  email: z.string().email().describe('Email address')
})
```

## Parsing Responses

### Basic Parsing

```typescript
const response = await model.complete(messages, { schema })
const data = JSON.parse(response.content)
```

### With Validation

```typescript
const response = await model.complete(messages, { schema })

try {
  const data = schema.parse(JSON.parse(response.content))
  // data is validated and typed
} catch (error) {
  console.error('Validation failed:', error)
}
```

### TypeScript Types

Get types from Zod schemas:

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number()
})

type Person = z.infer<typeof schema>
// Person = { name: string; age: number }

const response = await model.complete(messages, { schema })
const person: Person = JSON.parse(response.content)
```

## Examples

### Data Extraction

```typescript
const schema = z.object({
  name: z.string(),
  company: z.string(),
  position: z.string(),
  email: z.string().email()
})

const messages = [
  new Message('user', `
    Extract contact info:
    Jane Smith works at Acme Corp as Senior Engineer.
    Contact: jane.smith@acme.com
  `)
]

const response = await model.complete(messages, { schema })
const contact = JSON.parse(response.content)
```

### Content Classification

```typescript
const schema = z.object({
  category: z.enum(['tech', 'sports', 'politics', 'entertainment']),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  keywords: z.array(z.string())
})

const messages = [
  new Message('user', 'Classify: The new smartphone features...')
]

const response = await model.complete(messages, { schema })
const classification = JSON.parse(response.content)
```

### Form Generation

```typescript
const schema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['text', 'number', 'select', 'checkbox']),
      label: z.string(),
      required: z.boolean(),
      options: z.array(z.string()).optional()
    })
  )
})

const messages = [
  new Message('user', 'Create a user registration form')
]

const response = await model.complete(messages, { schema })
const form = JSON.parse(response.content)
```

### List Extraction

```typescript
const schema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      price: z.number()
    })
  ),
  total: z.number()
})

const messages = [
  new Message('user', 'Extract items from receipt: [receipt text]')
]

const response = await model.complete(messages, { schema })
const receipt = JSON.parse(response.content)
```

## Prompt Engineering

### With Strict Enforcement

Providers with strict enforcement handle schemas automatically:

```typescript
// No special prompt needed
const messages = [
  new Message('user', 'Extract: [data]')
]
```

### With Prompt-Based Enforcement

For providers without strict enforcement, describe the schema:

```typescript
const messages = [
  new Message('system', `
    Always respond with valid JSON matching this schema:
    {
      "name": "string",
      "age": "number",
      "email": "string"
    }
  `),
  new Message('user', 'Extract: [data]')
]
```

## Error Handling

Handle parsing and validation errors:

```typescript
try {
  const response = await model.complete(messages, { schema })
  const data = schema.parse(JSON.parse(response.content))
  return data
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Schema validation failed:', error.errors)
  } else if (error instanceof SyntaxError) {
    console.error('JSON parsing failed:', error.message)
  } else {
    console.error('Request failed:', error)
  }
}
```

## Best Practices

1. **Use descriptions**: Help the model understand field meanings
2. **Keep schemas simple**: Complex schemas may confuse the model
3. **Validate output**: Always validate parsed JSON against schema
4. **Handle errors**: Models may not always follow schema perfectly
5. **Test with examples**: Provide example outputs in prompts
6. **Use enums**: Constrain values to known options

## Limitations

- **Model capability**: Not all models support structured output equally
- **Schema complexity**: Very complex schemas may fail
- **Nested depth**: Deep nesting can cause issues
- **Array sizes**: Very large arrays may be truncated
- **Prompt space**: Schemas consume prompt tokens

## Streaming

Structured output works with streaming, but the full response must be collected first:

```typescript
let fullContent = ''

const stream = model.generate(messages, { schema })

for await (const chunk of stream) {
  if (chunk.type === 'content' && chunk.text) {
    fullContent += chunk.text
  }
}

const data = schema.parse(JSON.parse(fullContent))
```

## Next Steps

- Review [Zod documentation](https://zod.dev) for advanced schemas
- Learn about [Completion](/guide/completion) options
- Explore [Function Calling](/guide/function-calling) for dynamic responses
