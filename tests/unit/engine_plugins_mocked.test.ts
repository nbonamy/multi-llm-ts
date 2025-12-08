
import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3, CustomPlugin, MultiPlugin, PluginUpdate } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import { EngineCreateOpts } from '../../src/types/index'
import { PluginExecutionUpdate } from '../../src/types/plugin'

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
  expect(await llm.getAvailableTools()).toStrictEqual([
    {
      type: 'function',
      function: {
        name: 'plugin1',
        description: 'Plugin 1',
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
        name: 'plugin2',
        description: 'Plugin 2',
        parameters: {
          type: 'object',
          properties: {
            param1: {
              type: 'string',
              description: 'Parameter 1',
            },
            param2: {
              type: 'number',
              description: 'Parameter 2',
            },
            param3: {
              type: 'array',
              description: 'Parameter 3',
              items: { type: 'string' },
            },
            param4: {
              type: 'array',
              description: 'Parameter 4',
              items: { type: 'string' },
            },
            param5: {
              type: 'array',
              description: 'Parameter 5',
              items: {
                type: 'object',
                properties: {
                  'key': {
                    type: 'string',
                    description: 'Key',
                  },
                  'value': {
                    type: 'number',
                    description: 'Value',
                  },
                },
                required: ['key'],
              }
            },
            param6: {
              type: 'string',
              description: 'Parameter 6',
            },
            param7: {
              type: 'array',
              description: 'Parameter 7',
              items: { type: 'string' },
            },
            param8: {
              type: 'array',
              description: 'Parameter 8',              
              items: {
                type: 'object',
                properties: {
                  'key': {
                    type: 'string',
                    description: 'Key',
                  },
                },
                required: [],
              }
            },
          },
          required: ['param1', 'param3'],
        },
      },
    },
  ])
})

test('Custom Tools Plugin', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new CustomPlugin())

  // @ts-expect-error protected
  expect(await llm.getAvailableTools()).toStrictEqual([
    {
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
    },
  ])

})

test('Multi Tools Plugin', async () => {

  const llm = new OpenAI(config)
  llm.addPlugin(new MultiPlugin())

  // @ts-expect-error protected
  expect(await llm.getAvailableTools()).toStrictEqual([
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
