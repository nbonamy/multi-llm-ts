
import Plugin from '../../src/plugin'

export class Plugin1 extends Plugin {
  
  isEnabled(): boolean {
    return true
  }

  getName(): string {
    return 'plugin1'
  }

  getDescription(): string {
    return 'Plugin 1'
  }

  getRunningDescription(): string {
    return 'run1'
  }

  getParameters(): any[] {
    return []
  }

// eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: any): Promise<any> {
    return 'result1'
  }
}

export class Plugin2 extends Plugin {

  isEnabled(): boolean {
    return true
  }

  getName(): string {
    return 'plugin2'
  }

  getDescription(): string {
    return 'Plugin 2'
  }

  getPreparationDescription(): string {
    return 'prep2'
  }

  getRunningDescription(): string {
    return 'run2'
  }

  getParameters(): any[] {
    return [
      {
        name: 'param1',
        type: 'string',
        description: 'Parameter 1',
        required: true
      },
      {
        name: 'param2',
        type: 'number',
        description: 'Parameter 2',
        required: false
      }
    ]
  }

  async execute(parameters: any): Promise<any> {
    return parameters
  }
}

export class Plugin3 extends Plugin {

  getName(): string {
    return 'plugin3'
  }

  getDescription(): string {
    return 'Plugin 3'
  }

  getParameters(): any[] {
    return []
  }
}

export class Plugin4 extends Plugin {

  isEnabled(): boolean {
    return true
  }
  
  getName(): string {
    return 'plugin4'
  }

  isCustomTool(): boolean {
    return true
  }

  getDescription(): string {
    return 'Plugin 4'
  }

  async getTools(): Promise<any|any[]> {
    return {
      type: 'function',
      function: {
        name: 'plugin4',
        description: 'Plugin 4',
        parameters: {
          type: 'object',
          properties: { },
          required: [],
        },
      },
    }
  }
}