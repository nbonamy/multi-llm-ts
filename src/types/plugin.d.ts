
import { LlmToolParameterOpenAI } from './llm.d'

export type PluginConfig = anyDict

export type PluginParameter = LlmToolParameterOpenAI

export interface Plugin {
  config: PluginConfig
  sezializeInTools(): boolean
  isEnabled(): boolean
  isMultiTool(): boolean
  getName(): string
  getDescription(): string
  getPreparationDescription(): string | null
  getRunningDescription(): string
  getParameters(): PluginParameter[]
  getTools(): Promise<anyDict | Array<anyDict>>
  handlesTool(name: string): boolean
  execute(parameters: anyDict): Promise<anyDict>
}
