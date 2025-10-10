import { IPlugin, PluginExecutionContext, PluginParameter } from './types/plugin'

export interface ICustomPlugin extends IPlugin {
  getTools(): Promise<any|any[]>
}

export class Plugin implements IPlugin {

  serializeInTools(): boolean {
    return true
  }

  isEnabled(): boolean {
    return true
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getCompletedDescription(tool: string, args: any, results: any): string|undefined {
    return undefined
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getCanceledDescription(tool: string, args: any): string|undefined {
    return undefined
  }

  getParameters(): PluginParameter[] {
    throw new Error('Not implemented')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(context: PluginExecutionContext , parameters: any): Promise<any> {
    throw new Error('Not implemented')
  }

  // this is optional so not implemented by default
  // executeWithUpdates?(context: PluginExecutionContext , parameters: any): AsyncGenerator<PluginExecutionUpdate> {}

  /**
   * Executes a promise with abort signal support and optional cleanup.
   * Races the promise against the abort signal.
   *
   * This is a generic helper that works with any Promise and AbortSignal,
   * not specific to IPC or any particular implementation.
   *
   * @param operation - The async operation to execute
   * @param abortSignal - Optional abort signal to monitor
   * @param onAbort - Optional callback invoked when abort is triggered (for cleanup)
   * @returns Promise that resolves with operation result or rejects on abort
   *
   * @example
   * // Simple fetch with abort
   * const data = await this.runWithAbort(
   *   fetch('https://api.example.com/data'),
   *   context.abortSignal
   * )
   *
   * @example
   * // With cleanup callback
   * const result = await this.runWithAbort(
   *   someAsyncOperation(),
   *   context.abortSignal,
   *   () => cleanup()
   * )
   */
  async runWithAbort<T>(
    operation: Promise<T>,
    abortSignal?: AbortSignal,
    onAbort?: () => void
  ): Promise<T> {

    // Check if already aborted before starting
    if (abortSignal?.aborted) {
      onAbort?.()
      throw new Error('Operation cancelled')
    }

    // If no abort signal, just return the promise
    if (!abortSignal) {
      return operation
    }

    // Race between completion and abort
    // Listener cleanup is automatic via { once: true } option
    return Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        abortSignal.addEventListener('abort', () => {
          onAbort?.()
          reject(new Error('Operation cancelled'))
        }, { once: true })
      })
    ])
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
