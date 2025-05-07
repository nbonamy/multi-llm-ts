
import { beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3, CustomPlugin, MultiPlugin } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import { EngineCreateOpts } from '../../src/types/index'

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
  }
})

test('Engine plugin descriptions', () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())
  expect(llm.getToolPreparationDescription('plugin1')).toBe('')
  expect(llm.getToolRunningDescription('plugin1', { arg: 'arg1' })).toBe('run1 of plugin1 with {"arg":"arg1"}')
  expect(llm.getToolPreparationDescription('plugin2')).toBe('prep2')
  expect(llm.getToolRunningDescription('plugin2', { arg: 'arg2' })).toBe('run2')
})

test('Multi Tools Plugin', () => {
  const plugin = new MultiPlugin()
  expect(plugin.handlesTool('multi1')).toBe(true)
  expect(plugin.handlesTool('multi2')).toBe(true)
  expect(plugin.handlesTool('multi3')).toBe(false)
})

test('Engine plugin execution', async () => {

  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new MultiPlugin())

  expect(await llm.callTool('plugin1', {})).toStrictEqual('result1')
  expect(await llm.callTool('plugin2', { param1: 'a', param2: 1 })).toStrictEqual({ param1: 'a', param2: 1 })
  expect(await llm.callTool('plugin3', {})).toStrictEqual({ error: 'Tool plugin3 does not exist. Check the tool list and try again.' })

  expect(await llm.callTool('multi1', { param: 'value1' })).toStrictEqual(['multi1', { param: 'value1' }])
  expect(await llm.callTool('multi2', { param: 'value2' })).toStrictEqual(['multi2', { param: 'value2' }])
  expect(await llm.callTool('multi3', {})).toStrictEqual({ error: 'Tool multi3 does not exist. Check the tool list and try again.' })
})

test('OpenAI Functions', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())
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
