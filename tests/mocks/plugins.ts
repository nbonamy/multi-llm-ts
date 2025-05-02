
import { PluginParameter } from '../../src/types/plugin'
import { CustomToolPlugin, MultiToolPlugin, Plugin } from '../../src/plugin'

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

  getRunningDescription(tool: string, args: any): string {
    return `run1 of ${tool} with ${JSON.stringify(args)}`
  }

  getParameters(): PluginParameter[] {
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

  getParameters(): PluginParameter[] {
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
      },
      {
        name: 'param3',
        type: 'array',
        description: 'Parameter 3',
        required: true
      },
      {
        name: 'param4',
        type: 'array',
        items: { type: 'string' },
        description: 'Parameter 4',
        required: false
      },
      {
        name: 'param5',
        type: 'array',
        items: {
          type: 'object',
          properties: [
            {
              name: 'key',
              type: 'string',
              description: 'Key',
              required: true
            },
            {
              name: 'value',
              type: 'number',
              description: 'Value',
            },
          ],
        },
        description: 'Parameter 5',
        required: false
      },
      // @ts-expect-error testing missing type
      {
        name: 'param6',
        description: 'Parameter 6',
      },
      // @ts-expect-error testing missing type
      {
        name: 'param7',
        description: 'Parameter 7',
        items: { type: 'string' },
      },
      // @ts-expect-error testing missing type
      {
        name: 'param8',
        description: 'Parameter 8',
        items: { type: 'object', properties: [
          { name: 'key', type: 'string', description: 'Key' },
        ] },
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

  getParameters(): PluginParameter[] {
    return []
  }
}

export class CustomPlugin extends CustomToolPlugin {

  isEnabled(): boolean {
    return true
  }
  
  getName(): string {
    return 'custom'
  }

  getDescription(): string {
    return 'Plugin Custom'
  }

  async getTools(): Promise<any|any[]> {
    return {
      type: 'function',
      function: {
        name: 'custom',
        description: 'Plugin Custom',
        parameters: {
          type: 'object',
          properties: { },
          required: [],
        },
      },
    }
  }
}

export class MultiPlugin extends MultiToolPlugin {

  isEnabled(): boolean {
    return true
  }

  getName(): string {
    return 'multi'
  }

  getDescription(): string {
    return 'Plugin Multi'
  }

  getTools(): Promise<any|any[]> {
    return Promise.resolve([
      {
        type: 'function',
        function: {
          name: 'multi1',
          description: 'Tool Multi 1',
          parameters: {
            type: 'object',
            properties: { },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'multi2',
          description: 'Tool Multi 2',
          parameters: {
            type: 'object',
            properties: { },
            required: [],
          },
        },
      },
    ])
  }

  handlesTool(name: string): boolean {
    return name === 'multi1' || name === 'multi2'
  }

  async execute(parameters: any): Promise<any> {
    return [parameters.tool, parameters.parameters]
  }

}
