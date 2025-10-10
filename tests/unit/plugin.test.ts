import { expect, test } from 'vitest'
import { MultiToolPlugin, Plugin } from '../../src/plugin'

class TestPlugin extends Plugin {
  getName(): string {
    return 'test'
  }
  getDescription(): string {
    return 'Test plugin'
  }
  getRunningDescription(): string {
    return 'Running'
  }
  getParameters() {
    return []
  }
  async execute() {
    return { result: 'test' }
  }
}

class TestMultiToolPlugin extends MultiToolPlugin {
  getName(): string {
    return 'multi'
  }
  getDescription(): string {
    return 'Multi tool plugin'
  }
  getRunningDescription(): string {
    return 'Running'
  }
  getParameters() {
    return []
  }
  async execute() {
    return { result: 'multi' }
  }
  async getTools() {
    return ['tool1', 'tool2', 'tool3']
  }
  handlesTool(name: string): boolean {
    if (name === 'tool1' || name === 'tool2' || name === 'tool3') {
      return !this.toolsEnabled || this.toolsEnabled.includes(name)
    }
    return false
  }
}

test('Plugin.getCanceledDescription() returns undefined by default', () => {
  const plugin = new TestPlugin()
  expect(plugin.getCanceledDescription('test', {})).toBeUndefined()
})

test('Plugin.getCompletedDescription() returns undefined by default', () => {
  const plugin = new TestPlugin()
  expect(plugin.getCompletedDescription('test', {}, {})).toBeUndefined()
})

test('Plugin.getPreparationDescription() returns empty string by default', () => {
  const plugin = new TestPlugin()
  expect(plugin.getPreparationDescription('test')).toBe('')
})

test('MultiToolPlugin.enableTool() initializes toolsEnabled array', () => {
  const plugin = new TestMultiToolPlugin()
  expect(plugin.toolsEnabled).toBeNull()

  plugin.enableTool('tool1')
  expect(plugin.toolsEnabled).toEqual(['tool1'])
})

test('MultiToolPlugin.enableTool() adds tool to existing array', () => {
  const plugin = new TestMultiToolPlugin()
  plugin.enableTool('tool1')
  plugin.enableTool('tool2')

  expect(plugin.toolsEnabled).toEqual(['tool1', 'tool2'])
})

test('MultiToolPlugin.enableTool() does not add duplicates', () => {
  const plugin = new TestMultiToolPlugin()
  plugin.enableTool('tool1')
  plugin.enableTool('tool1')
  plugin.enableTool('tool1')

  expect(plugin.toolsEnabled).toEqual(['tool1'])
})

test('MultiToolPlugin.handlesTool() returns false for unknown tools', () => {
  const plugin = new TestMultiToolPlugin()
  expect(plugin.handlesTool('unknown')).toBe(false)
  expect(plugin.handlesTool('not-a-tool')).toBe(false)
  expect(plugin.handlesTool('')).toBe(false)
})

test('MultiToolPlugin base class handlesTool() returns false', () => {
  // Test the base class default implementation
  const plugin = new MultiToolPlugin()
  expect(plugin.handlesTool('anything')).toBe(false)
})

test('MultiToolPlugin.handlesTool() with toolsEnabled filter', () => {
  const plugin = new TestMultiToolPlugin()

  // All tools enabled when toolsEnabled is null
  expect(plugin.handlesTool('tool1')).toBe(true)
  expect(plugin.handlesTool('tool2')).toBe(true)
  expect(plugin.handlesTool('tool3')).toBe(true)

  // Only enabled tools allowed
  plugin.enableTool('tool1')
  expect(plugin.handlesTool('tool1')).toBe(true)
  expect(plugin.handlesTool('tool2')).toBe(false)
  expect(plugin.handlesTool('tool3')).toBe(false)

  // Add more tools
  plugin.enableTool('tool3')
  expect(plugin.handlesTool('tool1')).toBe(true)
  expect(plugin.handlesTool('tool2')).toBe(false)
  expect(plugin.handlesTool('tool3')).toBe(true)
})

test('MultiToolPlugin.toolsEnabled starts as null', () => {
  const plugin = new TestMultiToolPlugin()
  expect(plugin.toolsEnabled).toBeNull()
})

test('MultiToolPlugin.enableTool() creates empty array on first call', () => {
  const plugin = new TestMultiToolPlugin()
  expect(plugin.toolsEnabled).toBeNull()

  plugin.enableTool('tool1')

  expect(plugin.toolsEnabled).not.toBeNull()
  expect(Array.isArray(plugin.toolsEnabled)).toBe(true)
  expect(plugin.toolsEnabled).toHaveLength(1)
})
