import { PluginParameter, ToolDefinition } from './types/plugin'
import { LlmTool, LlmToolArrayItems, LlmToolOpenAI, LlmToolParameterOpenAI } from './types/llm'

/**
 * Type guard to check if a tool is in the new ToolDefinition format.
 * ToolDefinition has parameters as an array, while OpenAI format has nested structure.
 */
export function isToolDefinition(tool: LlmTool): tool is ToolDefinition {
  return Array.isArray((tool as ToolDefinition).parameters)
}

/**
 * Type guard to check if a tool is in the legacy OpenAI format.
 */
export function isLegacyOpenAITool(tool: LlmTool): tool is LlmToolOpenAI {
  return 'type' in tool && tool.type === 'function' && 'function' in tool
}

/**
 * Normalizes any LlmTool format to ToolDefinition.
 * Use this to convert legacy OpenAI format tools to the new format.
 */
export function normalizeToToolDefinition(tool: LlmTool): ToolDefinition {
  if (isToolDefinition(tool)) {
    return tool
  }

  // Convert from OpenAI format
  const params: PluginParameter[] = []
  const props = tool.function.parameters?.properties || {}
  const required = tool.function.parameters?.required || []

  for (const [name, prop] of Object.entries(props)) {
    params.push({
      name,
      type: prop.type,
      description: prop.description,
      required: required.includes(name),
      ...(prop.enum ? { enum: prop.enum } : {}),
      ...(prop.items ? { items: convertOpenAIItems(prop.items) } : {}),
    })
  }

  return {
    name: tool.function.name,
    description: tool.function.description,
    parameters: params,
  }
}

/**
 * Converts a ToolDefinition to OpenAI format.
 * Use this for providers that use OpenAI SDK or expect OpenAI format.
 */
export function toolDefinitionToOpenAI(tool: ToolDefinition): LlmToolOpenAI {
  const properties: Record<string, LlmToolParameterOpenAI> = {}
  const required: string[] = []

  for (const param of tool.parameters) {
    const type = param.type || (param.items ? 'array' : 'string')
    const prop: LlmToolParameterOpenAI = {
      type,
      description: param.description,
      ...(param.enum ? { enum: param.enum } : {}),
    }
    // arrays must have items — default to string if missing
    if (type === 'array') {
      prop.items = convertToOpenAIItems(param.items)
    }
    properties[param.name] = prop
    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  }
}

/**
 * Converts any LlmTool to OpenAI format.
 * If already in OpenAI format, returns as-is.
 */
export function toOpenAITool(tool: LlmTool): LlmToolOpenAI {
  if (isLegacyOpenAITool(tool)) {
    return tool
  }
  return toolDefinitionToOpenAI(tool)
}

/**
 * Normalizes an array of tools to ToolDefinition format.
 */
export function normalizeTools(tools: LlmTool[]): ToolDefinition[] {
  return tools.map(normalizeToToolDefinition)
}

/**
 * Converts an array of tools to OpenAI format.
 */
export function toOpenAITools(tools: LlmTool[]): LlmToolOpenAI[] {
  return tools.map(toOpenAITool)
}

// Helper to convert OpenAI items format to PluginParameter items format
function convertOpenAIItems(items: LlmToolArrayItems): PluginParameter['items'] {
  if (!items.properties) {
    return { type: items.type }
  }

  // LlmToolArrayItems.properties is an array of LlmToolArrayItem
  const props: PluginParameter[] = items.properties.map((prop) => ({
    name: prop.name,
    type: prop.type,
    description: prop.description,
    required: prop.required,
  }))

  return {
    type: items.type,
    properties: props,
  }
}

// Helper to convert PluginParameter items to OpenAI JSON Schema items format
// Returns a proper JSON Schema object with properties as Record<string, ...>
function convertToOpenAIItems(items: PluginParameter['items']): any {
  if (!items) return { type: 'string' }
  if (!items.properties) {
    return { type: items.type }
  }

  // object with nested properties: convert array to Record
  const props: Record<string, any> = {}
  const required: string[] = []
  for (const param of items.properties) {
    props[param.name] = {
      type: param.type,
      description: param.description,
    }
    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    type: items.type || 'object',
    properties: props,
    required,
  }
}
