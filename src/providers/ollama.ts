
import { EngineCreateOpts, Model, ModelsList } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall, LlmUsage } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import { Ollama, ChatResponse, ProgressResponse } from 'ollama/dist/browser.cjs'

export default class extends LlmEngine {

  client: any
  currentModel: string = ''
  currentThread: LLmCompletionPayload[] = []
  currentOpts: LlmCompletionOpts|null = null
  currentUsage: LlmUsage|null = null
  toolCalls: LlmToolCall[] = []

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static isConfigured = (engineConfig: EngineCreateOpts): boolean => {
    return true
  }

  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new Ollama({
      host: config.baseURL,
    })
  }

  getName(): string {
    return 'ollama'
  }

  getVisionModels(): string[] {
    return [ 'llama3.2-vision*', 'llava-llama3:latest', 'llava:latest', '*llava*' ]
  }

  modelSupportsTools(model: string): boolean {
    return [
      'athene-v2',
      'aya-expanse',
      'command-r-plus',
      'command-r',
      'firefunction-v2',
      'granite3-dense',
      'hermes3',
      'llama3-groq-tool-use',
      'llama3.1',
      'llama3.2',
      'llama3.3',
      'mistral-large',
      'mistral-nemo',
      'mistral-small',
      'mistral',
      'mixtral',
      'nemotron-mini',
      'nemotron',
      'qwen2.5-coder',
      'qwen2.5',
      'qwen2',
      'qwq',
      'smollm2',
    ].includes(model.split(':')[0])
  }

  async getModels(): Promise<Model[]> {
    try {
      const response = await this.client.list()
      return response.models.map((model: any) => {
        return {
          id: model.model,
          name: model.name,
          meta: model,
        }
      })
    } catch (error) {
      console.error('Error listing models:', error);
      return [] 
    }
  }

  async getModelInfo(model: string): Promise<any> {
    try {
      return await this.client.show({ model: model })
    } catch (error) {
      console.error('Error listing models:', error);
      return
    }
  }

  async pullModel(model: string): Promise<AsyncGenerator<ProgressResponse>|null> {
    try {
      return this.client.pull({
        model: model,
        stream: true
      })
    } catch (error) {
      console.error('Error pulling models:', error);
      return null
    }
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    logger.log(`[ollama] prompting model ${model}`)
    const response = await this.client.chat({
      model: model,
      messages: this.buildPayload(model, thread),
      stream: false
    });

    // return an object
    return {
      type: 'text',
      content: response.message.content,
      ...(opts?.usage ?  { usage: {
        prompt_tokens: response.prompt_eval_count,
        completion_tokens: response.eval_count,
      } } : {})
    }
  }

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(model, thread, opts)

    // save the message thread
    this.currentThread = this.buildPayload(this.currentModel, thread)

    // save the opts and do it
    this.currentOpts = opts || null
    this.currentUsage = { prompt_tokens: 0, completion_tokens: 0 }
    return await this.doStream()
  }


  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    // tools
    const tools = await this.getAvailableTools()
  
    // call
    logger.log(`[ollama] prompting model ${this.currentModel}`)
    const stream = this.client.chat({
      model: this.currentModel,
      messages: this.currentThread,
      ...(this.modelSupportsTools(this.currentModel) && tools.length ? {
        tools: tools,
        tool_choice: 'auto',
      } : {}),
      stream: true,
    })

    // done
    return stream

  }

  async stop() {
    await this.client.abort()
  }

  async *nativeChunkToLlmChunk(chunk: ChatResponse): AsyncGenerator<LlmChunk, void, void> {

    // debug
    //logger.log('nativeChunkToLlmChunk', chunk)

    // add usage
    if (chunk.done && this.currentUsage && (chunk.eval_count || chunk.prompt_eval_count)) {
      this.currentUsage.prompt_tokens += chunk.prompt_eval_count
      this.currentUsage.completion_tokens += chunk.eval_count
    }

    // tool calls
    if (chunk.message.tool_calls?.length) {

      // debug
      // console.log('tool calls', JSON.stringify(chunk.message.tool_calls))

      // iterate on each tool
      for (const tool of chunk.message.tool_calls) {

        // record the tool call
        const toolCall: LlmToolCall = {
          id: `${this.toolCalls.length}`,
          message: tool,
          function: tool.function.name,
          args: JSON.stringify(tool.function.arguments || ''),
        }
        this.toolCalls.push(toolCall)

        // first notify prep
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }
        
        // now notify running
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function),
          done: false
        }

        // now execute
        const args = JSON.parse(toolCall.args)
        logger.log(`[${this.getName()}] tool call ${toolCall.function} with ${JSON.stringify(args)}`)
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[${this.getName()}] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool response message
        this.currentThread.push({
          role: 'tool',
          content: JSON.stringify(content)
        })

        // clear
        yield {
          type: 'tool',
          name: toolCall.function,
          done: true,
          call: {
            params: args,
            result: content
          },
        }        

      }
    
      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(),
      }

      // done
      return

    } else {

      yield {
        type: 'content',
        text: chunk.message.content || '',
        done: chunk.done
      }

    }

    if (this.currentOpts?.usage && this.currentUsage && chunk.done) {
      yield {
        type: 'usage',
        usage: this.currentUsage
      }
    } 
  
  }

  addAttachmentToPayload(message: Message, payload: LLmCompletionPayload) {
    if (message.attachment) {
      payload.images = [ message.attachment.content ]
    }
  }

}
