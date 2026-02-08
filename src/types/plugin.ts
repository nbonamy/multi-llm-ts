
import { LlmToolExecutionValidationResponse, ToolParameterType } from './llm'

export interface IPlugin {

  serializeInTools(): boolean
  isEnabled(): boolean
  getName(): string
  getDescription(): string
  getPreparationDescription(tool: string): string
  getRunningDescription(tool: string, args: any): string
  getCompletedDescription(tool: string, args: any, results: any): string|undefined
  getParameters(): PluginParameter[]
  execute(context: PluginExecutionContext , parameters: any): Promise<any>
  executeWithUpdates?(context: PluginExecutionContext , parameters: any): AsyncGenerator<PluginExecutionUpdate>
}

export type PluginParameter = {
  name: string
  type: ToolParameterType
  description: string
  required?: boolean
  enum?: string[]
  items?: {
    type: string,
    properties?: PluginParameter[]
  }
}

/**
 * Provider-agnostic tool definition format.
 * This is the recommended format for defining tools in plugins.
 * It will be converted to provider-specific formats internally.
 */
export type PluginTool = {
  name: string
  description: string
  parameters: PluginParameter[]
}

export type PluginExecutionContext = {
  model: string
  abortSignal?: AbortSignal
}

export type PluginExecutionStatusUpdate = {
  type: 'status'
  status: string
}

export type PluginExecutionResult = {
  type: 'result'
  result: any
  canceled?: boolean
  validation?: LlmToolExecutionValidationResponse
}

export type PluginExecutionUpdate = PluginExecutionStatusUpdate | PluginExecutionResult
