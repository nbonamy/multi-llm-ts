# Plugin

Base class for creating tools and functions.

## Overview

The `Plugin` class is the base for all function calling implementations. Extend it to create custom tools that models can invoke.

```typescript
import { Plugin, PluginParameter, PluginExecutionContext } from 'multi-llm-ts'

export class MyPlugin extends Plugin {
  // Implement required methods
}
```

See the [Plugins Guide](/guide/plugins) for detailed usage.

## Required Methods

### getName()

Return the tool name:

```typescript
getName(): string
```

**Example:**
```typescript
getName(): string {
  return 'get_weather'
}
```

### getDescription()

Describe what the tool does:

```typescript
getDescription(): string
```

**Example:**
```typescript
getDescription(): string {
  return 'Get current weather for a location'
}
```

### getParameters()

Define tool parameters:

```typescript
getParameters(): PluginParameter[]
```

**Example:**
```typescript
getParameters(): PluginParameter[] {
  return [
    {
      name: 'location',
      type: 'string',
      description: 'City name',
      required: true
    },
    {
      name: 'units',
      type: 'string',
      description: 'Temperature units',
      required: false,
      enum: ['celsius', 'fahrenheit']
    }
  ]
}
```

### execute()

Implement the tool logic:

```typescript
async execute(
  context: PluginExecutionContext,
  parameters: any
): Promise<any>
```

**Example:**
```typescript
async execute(
  context: PluginExecutionContext,
  parameters: any
): Promise<any> {
  const { location, units = 'celsius' } = parameters

  const weather = await fetchWeather(location, units)

  return {
    temperature: weather.temp,
    condition: weather.condition
  }
}
```

## Optional Methods

### isEnabled()

Control if plugin is active:

```typescript
isEnabled(): boolean
```

**Default:** `true`

**Example:**
```typescript
isEnabled(): boolean {
  return process.env.API_KEY !== undefined
}
```

### Status Descriptions

Customize status messages:

```typescript
getPreparationDescription(tool: string): string
getRunningDescription(tool: string, args: any): string
getCompletedDescription(tool: string, args: any, result: any): string
getCanceledDescription(tool: string, args: any): string
```

**Example:**
```typescript
getPreparationDescription(tool: string): string {
  return 'Preparing weather lookup...'
}

getRunningDescription(tool: string, args: any): string {
  return `Fetching weather for ${args.location}...`
}

getCompletedDescription(tool: string, args: any, result: any): string {
  return `Weather: ${result.temperature}°, ${result.condition}`
}

getCanceledDescription(tool: string, args: any): string {
  return 'Weather lookup was cancelled'
}
```

## Helper Methods

### runWithAbort()

Race a promise against abort signal:

```typescript
protected async runWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  cleanup?: () => void
): Promise<T>
```

**Example:**
```typescript
async execute(context, params) {
  const result = await this.runWithAbort(
    longOperation(params),
    context.abortSignal,
    () => cleanup()
  )

  return result
}
```

## Types

### PluginParameter

```typescript
type ToolParameterType = 'string' | 'number' | 'boolean' | 'object' | 'array'

interface PluginParameter {
  name: string
  type: ToolParameterType
  description: string
  required?: boolean
  enum?: string[]
  items?: {
    type: string
    properties?: PluginParameter[]
  }
}
```

### PluginExecutionContext

```typescript
interface PluginExecutionContext {
  modelId: string
  abortSignal?: AbortSignal
}
```

## Complete Example

```typescript
import { Plugin, PluginParameter, PluginExecutionContext } from 'multi-llm-ts'

export class WeatherPlugin extends Plugin {

  isEnabled(): boolean {
    return process.env.WEATHER_API_KEY !== undefined
  }

  getName(): string {
    return 'get_weather'
  }

  getDescription(): string {
    return 'Get current weather for any location'
  }

  getParameters(): PluginParameter[] {
    return [
      {
        name: 'location',
        type: 'string',
        description: 'City name or coordinates',
        required: true
      },
      {
        name: 'units',
        type: 'string',
        description: 'Temperature units (celsius or fahrenheit)',
        required: false,
        enum: ['celsius', 'fahrenheit'],
        default: 'celsius'
      }
    ]
  }

  getPreparationDescription(tool: string): string {
    return 'Preparing to fetch weather data...'
  }

  getRunningDescription(tool: string, args: any): string {
    return `Fetching weather for ${args.location}...`
  }

  getCompletedDescription(tool: string, args: any, result: any): string {
    return `Weather: ${result.temperature}° ${result.condition}`
  }

  getCanceledDescription(tool: string, args: any): string {
    return 'Weather lookup was cancelled'
  }

  async execute(
    context: PluginExecutionContext,
    parameters: any
  ): Promise<any> {
    const { location, units = 'celsius' } = parameters

    // Check if aborted
    if (context.abortSignal?.aborted) {
      throw new Error('Operation cancelled')
    }

    // Use helper for async operation
    const weather = await this.runWithAbort(
      this.fetchWeather(location, units),
      context.abortSignal
    )

    return {
      location,
      temperature: weather.temp,
      condition: weather.condition,
      humidity: weather.humidity,
      units
    }
  }

  private async fetchWeather(location: string, units: string) {
    const apiKey = process.env.WEATHER_API_KEY
    const url = `https://api.weather.com/v1/current?location=${location}&units=${units}&key=${apiKey}`

    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.statusText}`)
    }

    return response.json()
  }
}
```

## Usage

```typescript
import { igniteModel } from 'multi-llm-ts'
import { WeatherPlugin } from './plugins/weather'

const model = igniteModel('openai', chatModel, config)
model.addPlugin(new WeatherPlugin())

const messages = [
  new Message('user', 'What is the weather in Paris?')
]

const response = await model.complete(messages)
```

## Best Practices

1. **Validate inputs**: Check parameters before executing
2. **Handle errors**: Throw descriptive errors
3. **Return structured data**: Use objects with clear field names
4. **Support abort**: Check `context.abortSignal`
5. **Be efficient**: Minimize execution time
6. **Document well**: Clear descriptions help the model

## Next Steps

- Learn about [Function Calling](/guide/function-calling)
- Review [Tool Validation](/guide/tool-validation)
- Handle [Abort Operations](/guide/abort)
