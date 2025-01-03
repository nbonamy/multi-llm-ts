
import { PluginParameter } from 'types/plugin'

export default class Plugin {

  sezializeInTools(): boolean {
    return true
  }

  isEnabled(): boolean {
    return false
  }

  isCustomTool(): boolean {
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
    return ''
  }

  getRunningDescription(): string {
    throw new Error('Not implemented')
  }

  getParameters(): PluginParameter[] {
    throw new Error('Not implemented')
  }

  async getTools(): Promise<any|any[]> {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handlesTool(name: string): boolean {
    return false
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: any): Promise<any> {
    throw new Error('Not implemented')
  }

}