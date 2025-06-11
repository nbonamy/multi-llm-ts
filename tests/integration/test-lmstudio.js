#!/usr/bin/env node

/**
 * Manual test script for LMStudio
 * 
 * This script tests the real connection to LMStudio and displays detailed
 * information about available models and their functionality.
 * 
 * Usage:
 *   node test-lmstudio.js
 * 
 * Prerequisites:
 *   - LMStudio must be started
 *   - At least one model must be loaded
 *   - The server must be accessible on ws://localhost:1234
 */

const { LMStudioClient } = require('@lmstudio/sdk')
const { LMStudio, loadModels, igniteEngine, Message } = require('../../dist/index.js')

async function testLMStudioConnection() {
  console.log('🧪 LMStudio Connection Test')
  console.log('=' .repeat(50))
  
  try {
    // Test 1: Direct SDK connection
    console.log('\n1️⃣  Testing direct connection to LMStudio SDK...')
    const client = new LMStudioClient({ baseUrl: 'ws://localhost:1234' })
    
    const models = await client.llm.listLoaded()
    console.log(`✅ Connection successful! ${models.length} model(s) found:`)
    
    models.forEach((model, index) => {
      console.log(`   ${index + 1}. ${model.path || model.name || 'Unknown model'}`)
    })
    
    if (models.length === 0) {
      console.log('⚠️  No models loaded in LMStudio.')
      console.log('   Please load a model before continuing.')
      return
    }    
    // Test 2: Simple completion test
    console.log('\n2️⃣  Testing simple completion...')
    const firstModel = models[0]
    const modelId = firstModel.path || firstModel.name || 'unknown'
    const model = await client.llm.model(modelId)
    
    console.log(`🤖 Using model: ${modelId}`)
    
    const prompts = [
      'Hello! How are you?',
      'What is the capital of France?',
      'Explain in one sentence what artificial intelligence is.',
      'Count from 1 to 5.',
      'What is 2 + 2?'
    ]
    
    for (const [index, prompt] of prompts.entries()) {
      try {
        console.log(`\n   Prompt ${index + 1}: "${prompt}"`)
        const response = await model.respond(prompt, {
          maxTokens: 100,
          temperature: 0.7
        })
        console.log(`   Response: "${response.content.trim()}"`)
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`)
      }
    }    
    // Test 3: Test via our provider
    console.log('\n3️⃣  Testing via our multi-llm-ts provider...')
    
    const config = { baseURL: 'ws://localhost:1234' }
    const lmstudio = igniteEngine('lmstudio', config)
    
    console.log(`✅ Provider initialized: ${lmstudio.getId()}`)
    
    const providerModels = await loadModels('lmstudio', config)
    if (providerModels && providerModels.chat.length > 0) {
      console.log(`✅ ${providerModels.chat.length} model(s) loaded via provider:`)
      
      providerModels.chat.forEach((model, index) => {
        console.log(`   ${index + 1}. ${model.name} (ID: ${model.id})`)
        console.log(`      Capabilities: tools=${model.capabilities.tools}, vision=${model.capabilities.vision}, reasoning=${model.capabilities.reasoning}`)
      })
      
      // Completion test via provider
      const testModel = providerModels.chat[0]
      const message = new Message('user', 'Say "Test successful with multi-llm-ts provider!"')
      
      console.log('\n   Testing completion via provider...')
      const response = await lmstudio.complete(testModel, [message], { usage: true })
      
      console.log(`   ✅ Response: "${response.content}"`)
      console.log(`   📊 Usage: ${JSON.stringify(response.usage)}`)
      
      // Streaming test
      console.log('\n   Testing streaming via provider...')
      const streamMessage = new Message('user', 'Count from 1 to 3 with an explanation for each number.')
      
      let streamedContent = ''
      const stream = lmstudio.generate(testModel, [streamMessage])
      
      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          process.stdout.write(chunk.text)
          streamedContent += chunk.text
        }
      }
      console.log('\n   ✅ Streaming completed')

      // Test 4: Model capabilities test
      console.log('\n4️⃣  Testing model capabilities...')
      const capabilities = lmstudio.getModelCapabilities(testModel)
      console.log('✅ Model capabilities:')
      console.log(`   Tools: ${capabilities.tools}`)
      console.log(`   Vision: ${capabilities.vision}`)
      console.log(`   Reasoning: ${capabilities.reasoning}`)

      // Test 5: Multi-turn conversation test
      console.log('\n5️⃣  Testing multi-turn conversation...')
      const conversation = [
        new Message('user', 'What is the capital of France?'),
        new Message('assistant', 'The capital of France is Paris.'),
        new Message('user', 'And approximately how many people live there?')
      ]

      const conversationResponse = await lmstudio.complete(testModel, conversation, { usage: true })
      console.log('✅ Conversation response:')
      console.log(`   Content: ${conversationResponse.content?.substring(0, 150)}${conversationResponse.content && conversationResponse.content.length > 150 ? '...' : ''}`)
      if (conversationResponse.usage) {
        console.log(`   Usage: ${JSON.stringify(conversationResponse.usage)}`)
      }

      // Test 6: Mathematical conversation test
      console.log('\n6️⃣  Testing mathematical conversation...')
      const mathConversation = [
        new Message('user', 'How much is 2 + 2?'),
        new Message('assistant', '2 + 2 equals 4.'),
        new Message('user', 'And 4 + 4?')
      ]

      const mathResponse = await lmstudio.complete(testModel, mathConversation)
      console.log('✅ Mathematical response:')
      console.log(`   Content: ${mathResponse.content?.substring(0, 100)}${mathResponse.content && mathResponse.content.length > 100 ? '...' : ''}`)
      
    } else {
      console.log('❌ No models found via provider')
    }      console.log('\n🎉 All tests completed successfully!')
    console.log('✅ The LMStudio provider works correctly with multi-llm-ts')
    console.log('\n💡 Tips for better usage:')
    console.log('   - Use smaller models for faster responses')
    console.log('   - Adjust temperature (0.1-1.0) according to your needs')
    console.log('   - Limit maxTokens to control response length')
    console.log('   - Use getModelCapabilities() to check supported features')
    console.log('   - Multi-turn conversations allow maintaining context')
    
  } catch (error) {
    console.error('\n❌ Error during test:', error.message)
      if (error.message.includes('ECONNREFUSED') || error.message.includes('WebSocket')) {
      console.log('\n🔧 Possible solutions:')
      console.log('   1. Check that LMStudio is started (lms server start)')
      console.log('   2. Check that the server is listening on localhost:1234')
      console.log('   3. Load at least one model in LMStudio')
      console.log('   4. Check server settings in LMStudio')
      console.log('   5. Check that @lmstudio/sdk is installed: npm list @lmstudio/sdk')
    }
  }
}

// Script execution
if (require.main === module) {
  testLMStudioConnection().catch(console.error)
}

module.exports = { testLMStudioConnection }
