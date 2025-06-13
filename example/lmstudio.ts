import { LMStudio, loadModels, Message, igniteEngine } from '../src/index'

// Example usage of LMStudio provider
async function lmstudioExample() {
  console.log('LMStudio Example')
  console.log('================')

  // Create LMStudio engine configuration
  const config = {
    baseURL: 'ws://localhost:1234' // Default LMStudio server URL
  }

  try {
    // Load available models using the string-based API
    console.log('\n1. Loading models...')
    const models = await loadModels('lmstudio', config)
    
    if (!models || models.chat.length === 0) {
      console.log('No models loaded in LMStudio. Please load a model first.')
      return
    }

    console.log(`Found ${models.chat.length} models:`)
    models.chat.forEach(model => {
      console.log(`  - ${model.name} (${model.id})`)
    })

    // Select first model
    const model = models.chat[0]
    console.log(`\nUsing model: ${model.name}`)

    // Create the engine instance
    const lmstudio = igniteEngine('lmstudio', config)    // Simple chat completion
    console.log('\n2. Simple chat completion...')
    const message = new Message('user', 'What is the meaning of life?')
    
    const response = await lmstudio.complete(model, [message], { usage: true })
    console.log('Response:', response.content)
    
    if (response.usage) {
      console.log('Usage:', response.usage)
    }

    // Streaming example
    console.log('\n3. Streaming response...')
    const streamMessage = new Message('user', 'Tell me a short story about a robot learning to feel emotions.')
    
    console.log('Streaming response:')
    const stream = lmstudio.generate(model, [streamMessage])
    
    for await (const chunk of stream) {
      if (chunk.type === 'content') {
        process.stdout.write(chunk.text)
      }
    }
    console.log('\n')

    // Conversation with multiple messages
    console.log('\n4. Multi-turn conversation...')
    const conversationMessages = [
      new Message('user', 'Hello! Can you help me with programming?'),
      new Message('assistant', 'Hello! I\'d be happy to help you with programming. What specific topic or language are you interested in?'),
      new Message('user', 'I want to learn about TypeScript interfaces.')
    ]

    const conversationResponse = await lmstudio.complete(model, conversationMessages)
    console.log('Conversation response:', conversationResponse.content)

    // With text attachment
    console.log('\n5. Chat with text attachment...')
    const messageWithAttachment = new Message('user', 'Please analyze this code:')
    // Add some sample code as attachment content
    messageWithAttachment.content += '\n\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n}'
    
    const attachmentResponse = await lmstudio.complete(model, [messageWithAttachment])
    console.log('Analysis response:', attachmentResponse.content)

  } catch (error) {
    console.error('Error:', error)
    console.log('\nMake sure LMStudio is running and has at least one model loaded.')
    console.log('You can start LMStudio and load a model like llama-3.2-1b-instruct.')
  }
}

// Run the example
if (require.main === module) {
  lmstudioExample().catch(console.error)
}

export default lmstudioExample
