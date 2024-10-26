
import { anyDict } from 'types/index.d'
import { PluginParameter, PluginConfig } from 'types/plugin.d'

export default class Plugin {

  config: PluginConfig
  
  constructor(config: PluginConfig) {
    this.config = config
  }

  sezializeInTools(): boolean {
    return true
  }

  isEnabled(): boolean {
    return false
  }

  isMultiTool(): boolean {
    return false
  }

  getName(): string {
    throw new Error('Not implemented')
  }

  getDescription(): string {
    throw new Error('Not implemented')
  }

  getPreparationDescription(): string {
    return null
  }

  getRunningDescription(): string {
    throw new Error('Not implemented')
  }

  getParameters(): PluginParameter[] {
    throw new Error('Not implemented')
  }

  async getTools(): Promise<anyDict|Array<anyDict>> {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handlesTool(name: string): boolean {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: anyDict): Promise<anyDict> {
    throw new Error('Not implemented')
  }

}