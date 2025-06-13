
import { LlmToolParameterOpenAI } from './llm'

export type PluginParameter = LlmToolParameterOpenAI

export type PluginExecutionContext = {
  model: string
}
