
import { PluginExecutionContext, PluginExecutionUpdate, PluginParameter } from '../../src/types/plugin'
import { CustomToolPlugin, MultiToolPlugin, Plugin } from '../../src/plugin'

export class NamedPlugin extends Plugin {

  name: string
  description: string

  constructor(name: string, description: string) {
    super()
    this.name = name
    this.description = description
  }

  getName(): string {
    return this.name
  }

  getDescription(): string {
    return this.description
  }

  getParameters(): PluginParameter[] {
    return []
  }
}

export class Plugin1 extends Plugin {
  
  getName(): string {
    return 'plugin1'
  }

  getDescription(): string {
    return 'Plugin 1'
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPreparationDescription(tool: string): string {
    return `prep1`
  }

  getRunningDescription(tool: string, args: any): string {
    return `run1 with ${JSON.stringify(args)}`
  }

  getParameters(): PluginParameter[] {
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    return 'result1'
  }
}

export class Plugin2 extends Plugin {

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

  // Parameters cover a wide range of edge cases to exercise
  // provider-specific conversion (Google, Anthropic, OpenAI Responses API, etc.)
  getParameters(): PluginParameter[] {
    return [
      // param1-2: basic primitive types
      { name: 'param1', type: 'string', description: 'Parameter 1', required: true },
      { name: 'param2', type: 'number', description: 'Parameter 2', required: false },
      // param3: array with no items — providers must handle missing items sub-schema
      { name: 'param3', type: 'array', description: 'Parameter 3', required: true },
      // param4: array with primitive items
      { name: 'param4', type: 'array', items: { type: 'string' }, description: 'Parameter 4', required: false },
      // param5: array with object items that have nested properties
      { name: 'param5', type: 'array', items: {
        type: 'object',
        properties: [
          { name: 'key', type: 'string', description: 'Key', required: true },
          { name: 'value', type: 'number', description: 'Value' },
        ],
      }, description: 'Parameter 5', required: false },
      // param6-8: malformed parameters with missing type field
      // tests provider resilience to plugins that omit required fields
      // @ts-expect-error testing missing type
      { name: 'param6', description: 'Parameter 6' },
      // @ts-expect-error testing missing type — has items but no type (should be 'array')
      { name: 'param7', description: 'Parameter 7', items: { type: 'string' } },
      // @ts-expect-error testing missing type — has object items with properties but no type
      { name: 'param8', description: 'Parameter 8', items: { type: 'object', properties: [
        { name: 'key', type: 'string', description: 'Key' },
      ] } },
      // param9: array with no items (well-formed variant of param3 edge case)
      // tests that providers don't crash when no items sub-schema is provided
      { name: 'param9', type: 'array', description: 'Parameter 9', required: false },
      // param10: array with object items but no properties
      // tests the items conversion path when items.type is object but has no nested schema
      { name: 'param10', type: 'array', description: 'Parameter 10', required: false, items: { type: 'object' } },
      // param11: array of objects where a nested property is itself an array
      // reproduces the Salesforce salesforce_search_all bug where nested array items are dropped
      { name: 'param11', type: 'array', items: {
        type: 'object',
        properties: [
          { name: 'name', type: 'string', description: 'Object name', required: true },
          { name: 'fields', type: 'array', description: 'Field names', items: { type: 'string' } },
          { name: 'limit', type: 'number', description: 'Max results' },
        ],
      }, description: 'Parameter 11', required: false },
      // param12: array of objects where a nested property is an array-of-arrays (2D)
      // reproduces the gsheets_update_cells bug where values: array<array<string>> loses inner items
      { name: 'param12', type: 'array', items: {
        type: 'object',
        properties: [
          { name: 'range', type: 'string', description: 'Cell range', required: true },
          // @ts-expect-error items.items not yet in type
          { name: 'values', type: 'array', description: '2D array of values', items: { type: 'array', items: { type: 'string' } } },
        ],
      }, description: 'Parameter 12', required: false },
    ]
  }

  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    return parameters
  }
}

export class Plugin3 extends Plugin {

  isEnabled(): boolean {
    return false
  }

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

// Purposefully uses the old OpenAI format (LlmToolOpenAI) in getTools()
// to test that normalizeToToolDefinition() correctly converts legacy format
// to PluginTool — validated in engine_plugins_mocked test('Multi Tools Plugin')
export class MultiPlugin extends MultiToolPlugin {

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

  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    return [parameters.tool, parameters.parameters]
  }

}

export class PluginUpdate extends Plugin {
  
  getName(): string {
    return 'pluginUpdate'
  }

  getDescription(): string {
    return 'Plugin Update'
  }

  getRunningDescription(tool: string, args: any): string {
    return `run1 of ${tool} with ${JSON.stringify(args)}`
  }

  getParameters(): PluginParameter[] {
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *executeWithUpdates?(context: PluginExecutionContext , parameters: any): AsyncGenerator<PluginExecutionUpdate> {
    yield { type: 'status', status: 'status1' }
    yield { type: 'status', status: 'status2' }
    yield { type: 'result', result: 'result' }
  }

}
