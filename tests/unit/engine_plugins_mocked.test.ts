
import { beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import OpenAI from '../../src/providers/openai'
import { EngineCreateOpts } from 'types'

let config: EngineCreateOpts = {}
beforeEach(() => {
  config = {
    apiKey: '123',
    models: { chat: [] },
    model: { chat: '' },
  }
})

test('Engine plugin descriptions', () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())
  expect(llm.getToolPreparationDescription('plugin1')).toBeNull()
  expect(llm.getToolRunningDescription('plugin1')).toBe('run1')
  expect(llm.getToolPreparationDescription('plugin2')).toBe('prep2')
  expect(llm.getToolRunningDescription('plugin2')).toBe('run2')
})

test('Engine plugin execution', async () => {
  const llm = new OpenAI(config)
  llm.addPlugin(new Plugin1())
  llm.addPlugin(new Plugin2())
  llm.addPlugin(new Plugin3())
  expect(await llm.callTool('plugin1', {})).toStrictEqual('result1')
  expect(await llm.callTool('plugin2', { param1: 'a', param2: 1 })).toStrictEqual({ param1: 'a', param2: 1 })
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
            'param1': {
              type: 'string',
              'enum': undefined,
              description: 'Parameter 1',
            },
            'param2': {
              type: 'number',
              'enum': undefined,
              description: 'Parameter 2',
            },
          },
          required: ['param1'],
        },
      },
    },
  ])
})
