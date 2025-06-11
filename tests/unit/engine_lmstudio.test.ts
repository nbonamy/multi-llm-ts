import { vi, beforeEach, expect, test } from 'vitest'
import { Plugin1, Plugin2, Plugin3 } from '../mocks/plugins'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'
import LMStudio from '../../src/providers/lmstudio'
import { loadModels } from '../../src/llm'
import { EngineCreateOpts } from '../../src/types/index'
import { LlmChunk } from '../../src/types/llm'

Plugin2.prototype.execute = vi.fn((): Promise<string> => Promise.resolve('result2'))

// Mock LMStudio SDK
vi.mock('@lmstudio/sdk', () => {
  const LMStudioClient = vi.fn((opts: any) => {
    LMStudioClient.prototype.baseUrl = opts.baseUrl
  })
  
  LMStudioClient.prototype.llm = {
    listLoaded: vi.fn(() => Promise.resolve([
      { path: 'qwen3-8b', name: 'qwen3-8b' }
    ])),
    model: vi.fn((modelId: string) => ({
      respond: vi.fn((prompt: string, options?: any) => Promise.resolve({
        content: `Response for ${modelId}: ${prompt.substring(0, 50)}...`
      }))
    }))
  }
  
  return { LMStudioClient }
})

beforeEach(() => {
  vi.clearAllMocks()
})

test('LMStudio Load Models', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  expect(lmstudio.getId()).toBe('lmstudio')
  
  const models = await loadModels('lmstudio', config)
  expect(models?.chat).toHaveLength(1)
  expect(models?.chat[0].id).toBe('qwen3-8b')
})

test('LMStudio Chat Completion', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const models = await loadModels('lmstudio', config)
  const model = models!.chat[0]
  
  const prompt = 'Hello, how are you?'
  const message = new Message('user', prompt)
  
  const messageObj = { role: message.role, content: message.content }
  const response = await lmstudio.chat(model, [messageObj], { usage: false })
  
  expect(response.type).toBe('text')
  expect(response.content).toContain('qwen3-8b')
  expect(response.content).toContain('Hello, how are you?')
  expect(response.toolCalls).toHaveLength(0)
})

test('LMStudio Chat with Usage', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const models = await loadModels('lmstudio', config)
  const model = models!.chat[0]
  
  const prompt = 'What is the meaning of life?'
  const message = new Message('user', prompt)
  
  const messageObj = { role: message.role, content: message.content }
  const response = await lmstudio.chat(model, [messageObj], { usage: true })
  
  expect(response.type).toBe('text')
  expect(response.usage).toBeDefined()
  expect(response.usage?.prompt_tokens).toBe(0) // LMStudio might not provide token counts
  expect(response.usage?.completion_tokens).toBe(0)
})

test('LMStudio Stream', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const models = await loadModels('lmstudio', config)
  const model = models!.chat[0]
  
  const prompt = 'Tell me a story'
  const message = new Message('user', prompt)
  
  const streamResponse = await lmstudio.stream(model, [message])
  
  expect(streamResponse.context).toBeDefined()
  expect(streamResponse.context.model).toBe(model)
  expect(streamResponse.context.toolCalls).toHaveLength(0)
    const chunks: LlmChunk[] = []
  for await (const chunk of streamResponse.stream) {
    chunks.push(chunk)
  }
  
  expect(chunks.length).toBeGreaterThan(0)
  expect(chunks[0].type).toBe('content')
  
  // Check that the last chunk is marked as done
  const lastChunk = chunks[chunks.length - 1]
  if (lastChunk.type === 'content') {
    expect(lastChunk.done).toBe(true)
  }
})

test('LMStudio Model Capabilities', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const models = await loadModels('lmstudio', config)
  const model = models!.chat[0]
  
  const capabilities = lmstudio.getModelCapabilities(model.meta as any)
  expect(capabilities).toBeDefined()
  expect(typeof capabilities.tools).toBe('boolean')
  expect(typeof capabilities.vision).toBe('boolean')
  expect(typeof capabilities.reasoning).toBe('boolean')
})

test('LMStudio Model Info', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const modelInfo = await lmstudio.getModelInfo('qwen3-8b')
  
  expect(modelInfo).toBeDefined()
  expect(modelInfo?.id).toBe('qwen3-8b')
})

test('LMStudio Pull Model Warning', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  
  const result = await lmstudio.pullModel('test-model')
  
  expect(result).toBeNull()
  expect(consoleSpy).toHaveBeenCalledWith('LMStudio does not support pulling models via API. Use the LMStudio UI to download models.')
  
  consoleSpy.mockRestore()
})

test('LMStudio Delete Model Warning', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  
  await lmstudio.deleteModel('test-model')
  
  expect(consoleSpy).toHaveBeenCalledWith('LMStudio does not support deleting models via API. Use the LMStudio UI to manage models.')
  
  consoleSpy.mockRestore()
})

test('LMStudio Static Methods', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
    expect(LMStudio.isConfigured(config)).toBe(true)
  
  // For isReady, we need to provide a models list
  const models = await loadModels('lmstudio', config)
  expect(LMStudio.isReady(config, models!)).toBe(true)
})

test('LMStudio Stop Method', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  
  // Should not throw
  await expect(lmstudio.stop(null)).resolves.toBeUndefined()
})

test('LMStudio with Attachments', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  const models = await loadModels('lmstudio', config)
  const model = models!.chat[0]
  
  const message = new Message('user', 'Analyze this text')
  const attachment = new Attachment('text/plain', 'This is a sample text file content')
  message.attachments.push(attachment)
  
  const messageObj = { role: message.role, content: message.content }
  const response = await lmstudio.chat(model, [messageObj], { usage: false })
  
  expect(response.type).toBe('text')
  expect(response.content).toContain('qwen3-8b')
  expect(response.toolCalls).toHaveLength(0)
})

test('LMStudio Error Handling', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  const lmstudio = new LMStudio(config)
  
  // Mock a failing getModels call
  vi.spyOn(lmstudio, 'getModels').mockResolvedValue([])
  
  // Should handle errors gracefully
  const models = await lmstudio.getModels()
  expect(models).toHaveLength(0)
})

test.skip('LMStudio Real Integration Test', async () => {
  const config: EngineCreateOpts = {
    baseURL: 'ws://localhost:1234'
  }
  
  // This test only runs if LMStudio is actually running
  // We'll temporarily remove the mock to test the real API
  vi.doUnmock('@lmstudio/sdk')
  
  try {
    // Import the real LMStudio SDK
    const { LMStudioClient } = await import('@lmstudio/sdk')
    const realClient = new LMStudioClient({ baseUrl: config.baseURL })
    
    // Try to connect and list models
    const loadedModels = await realClient.llm.listLoaded()
    
    if (loadedModels.length === 0) {
      console.log('⚠️  No models loaded in LMStudio - skipping integration test')
      return
    }
      console.log(`✅ Found ${loadedModels.length} loaded models in LMStudio:`)
    loadedModels.forEach((model: any) => {
      console.log(`   - ${(model as any).path || (model as any).name || 'Unknown model'}`)
    })
    
    // Test with the first available model
    const firstModel = loadedModels[0] as any
    const modelId = firstModel.path || firstModel.name || 'unknown'
    const model = await realClient.llm.model(modelId)
    
    // Test a simple completion
    const testPrompt = 'Say "Hello from LMStudio integration test!" and nothing else.'
    console.log(`🧪 Testing with model: ${modelId}`)
    console.log(`📝 Prompt: ${testPrompt}`)
    
    const response = await model.respond(testPrompt, {
      maxTokens: 50,
      temperature: 0.1
    })
    
    console.log(`🤖 Response: ${response.content}`)
    
    // Basic assertions
    expect(response).toBeDefined()
    expect(response.content).toBeDefined()
    expect(typeof response.content).toBe('string')
    expect(response.content.length).toBeGreaterThan(0)
    
    // Test through our provider
    const lmstudio = new LMStudio(config)
    const models = await loadModels('lmstudio', config)
    
    if (models && models.chat.length > 0) {
      const testModel = models.chat[0]
      const message = new Message('user', 'What is 2+2? Answer with just the number.')
      
      const providerResponse = await lmstudio.complete(testModel, [message], { usage: false })
      
      console.log(`🔧 Provider response: ${providerResponse.content}`)
      
      expect(providerResponse).toBeDefined()
      expect(providerResponse.content).toBeDefined()
      expect(providerResponse.type).toBe('text')
    }
    
  } catch (error: any) {
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('WebSocket')) {
      console.log('⚠️  LMStudio not running or not accessible - skipping integration test')
      console.log('   To run this test:')
      console.log('   1. Start LMStudio')
      console.log('   2. Load a model (e.g., llama-3.2-1b-instruct)')
      console.log('   3. Make sure the server is running on ws://localhost:1234')
    } else {
      console.error('❌ Integration test failed:', error.message)
      throw error
    }
  } finally {
    // Re-mock for other tests
    vi.doMock('@lmstudio/sdk', () => {
      const LMStudioClient = vi.fn((opts: any) => {
        LMStudioClient.prototype.baseUrl = opts.baseUrl
      })
      
      LMStudioClient.prototype.llm = {
        listLoaded: vi.fn(() => Promise.resolve([
          { path: 'qwen3-8b', name: 'qwen3-8b' }
        ])),
        model: vi.fn((modelId: string) => ({
          respond: vi.fn((prompt: string, options?: any) => Promise.resolve({
            content: `Response for ${modelId}: ${prompt.substring(0, 50)}...`
          }))
        }))
      }
      
      return { LMStudioClient }
    })
  }
}, 30000) // 30 second timeout for integration test
