
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3, CustomPlugin, MultiPlugin, PluginUpdate } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import { EngineCreateOpts } from '../../src/types/index'
import { PluginExecutionUpdate } from '../../src/types/plugin'
import { toOpenAITools } from '../../src/tools'

let config: EngineCreateOpts = {}
beforeEach(() => {
  vi.clearAllMocks()
  config = {
    apiKey: '123',
  }
})

test('Engine plugin descriptions', () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())
  // @ts-expect-error protected
  expect(llm.getToolPreparationDescription('plugin1')).toBe('prep1')
  // @ts-expect-error protected
  expect(llm.getToolRunningDescription('plugin1', { arg: 'arg1' })).toBe('run1 with {"arg":"arg1"}')
  // @ts-expect-error protected
  expect(llm.getToolPreparationDescription('plugin2')).toBe('prep2')
  // @ts-expect-error protected
  expect(llm.getToolRunningDescription('plugin2', { arg: 'arg2' })).toBe('run2')
})

test('Multi Tools Plugin', () => {
  const plugin = new MultiPlugin()
  expect(plugin.handlesTool('multi1')).toBe(true)
  expect(plugin.handlesTool('multi2')).toBe(true)
  expect(plugin.handlesTool('multi3')).toBe(false)
})

test('Engine plugin execution without updates', async () => {

  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new MultiPlugin())

  const callTool = async (...args: any) => {
    // @ts-expect-error protected
    for await (const update of llm.callTool(...args)) {
      if (update.type === 'result') {
        return update.result
      } else {
        test.fails(`Unexpected update type: ${update.type}`)
      }
    }
  }

  expect(await callTool({ model: 'model' }, 'plugin1', {})).toStrictEqual('result1')
  expect(await callTool({ model: 'model' }, 'plugin2', { param1: 'a', param2: 1 })).toStrictEqual({ param1: 'a', param2: 1 })
  expect(await callTool({ model: 'model' }, 'plugin3', {})).toStrictEqual({ error: 'Tool plugin3 does not exist. Check the tool list and try again.' })
  expect(await callTool({ model: 'model' }, 'multi1', { param: 'value1' })).toStrictEqual(['multi1', { param: 'value1' }])
  expect(await callTool({ model: 'model' }, 'multi2', { param: 'value2' })).toStrictEqual(['multi2', { param: 'value2' }])
  expect(await callTool({ model: 'model' }, 'multi3', {})).toStrictEqual({ error: 'Tool multi3 does not exist. Check the tool list and try again.' })

})

test('Engine plugin execution with updates', async () => {

  const updates: PluginExecutionUpdate[] = []

  const llm = new OpenAI(config)
  llm.addPlugin(new PluginUpdate())

  // @ts-expect-error protected
  for await (const update of llm.callTool({ model: 'model' }, 'pluginUpdate', {})) {
    updates.push(update)
  }

  expect(updates).toHaveLength(3)
  expect(updates[0]).toStrictEqual({ type: 'status', status: 'status1' })
  expect(updates[1]).toStrictEqual({ type: 'status', status: 'status2' })
  expect(updates[2]).toStrictEqual({ type: 'result', result: 'result' })

})

test('OpenAI Functions', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())

  // @ts-expect-error protected
  // Now returns PluginTool[] format (not OpenAI format)
  expect(await llm.getAvailableTools()).toStrictEqual([
    {
      name: 'plugin1',
      description: 'Plugin 1',
      parameters: [],
    },
    {
      name: 'plugin2',
      description: 'Plugin 2',
      parameters: [
        { name: 'param1', type: 'string', description: 'Parameter 1', required: true },
        { name: 'param2', type: 'number', description: 'Parameter 2', required: false },
        { name: 'param3', type: 'array', description: 'Parameter 3', required: true },
        { name: 'param4', type: 'array', description: 'Parameter 4', required: false, items: { type: 'string' } },
        { name: 'param5', type: 'array', description: 'Parameter 5', required: false, items: {
          type: 'object',
          properties: [
            { name: 'key', type: 'string', description: 'Key', required: true },
            { name: 'value', type: 'number', description: 'Value' },
          ]
        }},
        { name: 'param6', description: 'Parameter 6' },
        { name: 'param7', description: 'Parameter 7', items: { type: 'string' } },
        { name: 'param8', description: 'Parameter 8', items: {
          type: 'object',
          properties: [
            { name: 'key', type: 'string', description: 'Key' },
          ]
        }},
        { name: 'param9', type: 'array', description: 'Parameter 9', required: false },
        { name: 'param10', type: 'array', description: 'Parameter 10', required: false, items: { type: 'object' } },
        { name: 'param11', type: 'array', description: 'Parameter 11', required: false, items: {
          type: 'object',
          properties: [
            { name: 'name', type: 'string', description: 'Object name', required: true },
            { name: 'fields', type: 'array', description: 'Field names', items: { type: 'string' } },
            { name: 'limit', type: 'number', description: 'Max results' },
          ]
        }},
        { name: 'param12', type: 'array', description: 'Parameter 12', required: false, items: {
          type: 'object',
          properties: [
            { name: 'range', type: 'string', description: 'Cell range', required: true },
            { name: 'values', type: 'array', description: '2D array of values', items: { type: 'array', items: { type: 'string' } } },
          ]
        }},
      ],
    },
  ])
})

test('Custom Tools Plugin', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new CustomPlugin())

  // @ts-expect-error protected
  // CustomPlugin returns OpenAI format, but getAvailableTools normalizes to PluginTool
  expect(await llm.getAvailableTools()).toStrictEqual([
    {
      name: 'custom',
      description: 'Plugin Custom',
      parameters: [],
    },
  ])

})

test('Multi Tools Plugin', async () => {

  const llm = new OpenAI(config)
  llm.addPlugin(new MultiPlugin())

  // @ts-expect-error protected
  // MultiPlugin returns OpenAI format, but getAvailableTools normalizes to PluginTool
  expect(await llm.getAvailableTools()).toStrictEqual([
    {
      name: 'multi1',
      description: 'Tool Multi 1',
      parameters: [],
    },
    {
      name: 'multi2',
      description: 'Tool Multi 2',
      parameters: [],
    },
  ])

})

test('toOpenAITools conversion', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin2())

  // @ts-expect-error protected
  const toolDefs = await llm.getAvailableTools()
  const openaiTools = toOpenAITools(toolDefs)
  const props = openaiTools[0].function.parameters.properties

  // param3: array with no items — must default to items: { type: 'string' }
  expect(props.param3.type).toBe('array')
  expect(props.param3.items).toStrictEqual({ type: 'string' })

  // param5: items.properties must be a Record<string, ...> (not an array)
  expect(props.param5!.items!.properties).toStrictEqual({
    key: { type: 'string', description: 'Key' },
    value: { type: 'number', description: 'Value' },
  })
  expect(props.param5!.items!.required).toStrictEqual(['key'])

  // param6: no type, no items — should infer 'string'
  expect(props.param6.type).toBe('string')

  // param7: no type but has items — should infer 'array'
  expect(props.param7.type).toBe('array')
  expect(props.param7.items).toStrictEqual({ type: 'string' })

  // param8: same — items.properties must be a Record
  expect(props.param8!.items!.properties).toStrictEqual({
    key: { type: 'string', description: 'Key' },
  })

  // param9: same edge case
  expect(props.param9.type).toBe('array')
  expect(props.param9.items).toStrictEqual({ type: 'string' })

  // param11: nested array property inside object items must preserve items
  const param11Items = props.param11!.items!
  expect(param11Items.properties.fields.type).toBe('array')
  expect(param11Items.properties.fields.items).toStrictEqual({ type: 'string' })
  expect(param11Items.properties.name.type).toBe('string')
  expect(param11Items.properties.limit.type).toBe('number')

  // param12: array-of-arrays (2D) must preserve inner items
  const param12Items = props.param12!.items!
  expect(param12Items.properties.values.type).toBe('array')
  expect(param12Items.properties.values.items).toStrictEqual({ type: 'array', items: { type: 'string' } })

})

test('Plugin.runWithAbort() with no signal', async () => {
  const plugin = new Plugin1()
  const result = await plugin.runWithAbort(Promise.resolve('success'))
  expect(result).toBe('success')
})

test('Plugin.runWithAbort() with non-aborted signal', async () => {
  const plugin = new Plugin1()
  const abortController = new AbortController()
  const result = await plugin.runWithAbort(
    Promise.resolve('success'),
    abortController.signal
  )
  expect(result).toBe('success')
})

test('Plugin.runWithAbort() with already aborted signal', async () => {
  const plugin = new Plugin1()
  const abortController = new AbortController()
  abortController.abort()

  await expect(
    plugin.runWithAbort(Promise.resolve('success'), abortController.signal)
  ).rejects.toThrow('Operation cancelled')
})

test('Plugin.runWithAbort() abort during execution', async () => {
  const plugin = new Plugin1()
  const abortController = new AbortController()

  // Create a promise that resolves after abort
  const promise = new Promise((resolve) => {
    setTimeout(() => resolve('success'), 100)
  })

  // Abort after 10ms
  setTimeout(() => abortController.abort(), 10)

  await expect(
    plugin.runWithAbort(promise, abortController.signal)
  ).rejects.toThrow('Operation cancelled')
})

test('Plugin.runWithAbort() with cleanup callback', async () => {
  const plugin = new Plugin1()
  const abortController = new AbortController()
  const cleanup = vi.fn()

  abortController.abort()

  await expect(
    plugin.runWithAbort(Promise.resolve('success'), abortController.signal, cleanup)
  ).rejects.toThrow('Operation cancelled')

  expect(cleanup).toHaveBeenCalled()
})

test('Plugin receives abortSignal in context', async () => {
  const llm = new OpenAI(config)
  const plugin = new Plugin2()
  const executeSpy = vi.spyOn(plugin, 'execute')
  llm.addPlugin(plugin)

  const abortController = new AbortController()

  // @ts-expect-error protected
  for await (const update of llm.callTool({ model: 'model', abortSignal: abortController.signal }, 'plugin2', {})) {
    if (update.type === 'result') {
      // Plugin2 should have received the context with abortSignal
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'model',
          abortSignal: abortController.signal
        }),
        {}
      )
    }
  }
})

test('Tool state transitions', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin2())

  const chunks: any[] = []

  // @ts-expect-error protected
  for await (const update of llm.callTool({ model: 'model' }, 'plugin2', {})) {
    chunks.push(update)
  }

  // Should only have result chunk (no status updates for this plugin)
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toStrictEqual({
    type: 'result',
    result: {}
  })
})

test('Tool canceled state on abort', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin2())

  const abortController = new AbortController()
  abortController.abort()

  const chunks: any[] = []

  // @ts-expect-error protected
  for await (const update of llm.callTool({ model: 'model', abortSignal: abortController.signal }, 'plugin2', {})) {
    chunks.push(update)
  }

  // Should return canceled result
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toStrictEqual({
    type: 'result',
    result: { error: 'Operation cancelled' },
    canceled: true
  })
})
