
import { LlmToolExecutionValidationResponse, LlmToolParameterOpenAI } from './llm'

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

export type PluginParameter = LlmToolParameterOpenAI

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
