
import { PluginParameter } from 'types/plugin'

export interface ICustomPlugin {
  getTools(): Promise<any|any[]>
}

export class Plugin {

  serializeInTools(): boolean {
    return true
  }

  isEnabled(): boolean {
    return false
  }

  isCustomTool(): boolean {
    return false
  }

  getName(): string {
    throw new Error('Not implemented')
  }

  getDescription(): string {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPreparationDescription(tool: string): string {
    return ''
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getRunningDescription(tool: string, args: any): string {
    throw new Error('Not implemented')
  }

  getParameters(): PluginParameter[] {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: any): Promise<any> {
    throw new Error('Not implemented')
  }

}

export class CustomToolPlugin extends Plugin implements ICustomPlugin {

  async getTools(): Promise<any|any[]> {
    throw new Error('Not implemented')
  }

}

export class MultiToolPlugin extends Plugin implements ICustomPlugin{

  // this allows for only specific tools of a multi-tool plugin to be enabled
  // if null, all tools are enabled
  // if empty, no tools are enabled
  // implementation should make sure that getTools and handlesTool
  // check toolsEnabled when responding

  // example:
  // handlesTool(name: string): boolean {
  //   const handled = ...
  //   return handled && (!this.toolsEnabled || this.toolsEnabled.includes(name))
  // }

  toolsEnabled: string[]|null = null

  enableTool(name: string): void {
    if (!this.toolsEnabled) {
      this.toolsEnabled = []
    }
    if (!this.toolsEnabled.includes(name)) {
      this.toolsEnabled.push(name)
    }
  }
  
  getTools(): Promise<any[]> {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handlesTool(name: string): boolean {
    return false
  }

}
