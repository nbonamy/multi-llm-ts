
import { EngineCreateOpts, Model, ModelsList } from 'types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCall, LlmUsage } from 'types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'

// we do this for so that this can be imported in a browser
// importing from 'ollama' directly imports 'fs' which fails in browser
import { Ollama, ChatRequest, ChatResponse, ProgressResponse } from 'ollama/dist/browser.cjs'
import type { A as AbortableAsyncIterator } from 'ollama/dist/shared/ollama.f6b57f53.cjs'

export type OllamaStreamingContext = LlmStreamingContextTools & {
  usage: LlmUsage
  thinking: boolean
}

export default class extends LlmEngine {

  client: Ollama

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
      return response.models.map((model: any) => ({
        id: model.model,
        name: model.name,
        meta: model,
      }))
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

  async pullModel(model: string): Promise<AbortableAsyncIterator<ProgressResponse>|null> {
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
  
  async deleteModel(model: string): Promise<void> {
    try {
      await this.client.delete({ model: model })
    } catch (error) {
      console.error('Error deleting model:', error);
    }
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    logger.log(`[ollama] prompting model ${model}`)
    const response = await this.client.chat({
      ...this.buildChatOptions({
        model: model,
        messages: this.buildPayload(model, thread, opts),
        opts: opts || null,
      }),
      ...await this.getToolOpts(model, opts || {}),
      stream: false,
    })

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

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // context
    const context: OllamaStreamingContext = {
      model: model,
      thread: this.buildPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      thinking: false,
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }
  }

  async doStream(context: OllamaStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []
    context.thinking = false

    // call
    logger.log(`[ollama] prompting model ${context.model}`)
    const stream = this.client.chat({
      ...this.buildChatOptions({
        model: context.model,
        messages: context.thread,
        opts: context.opts
      }),
      ...await this.getToolOpts(context.model, context.opts || {}),
      stream: true,
    })

    // done
    return stream

  }

  buildChatOptions({ model, messages, opts }: { model: string, messages: LLmCompletionPayload[], opts: LlmCompletionOpts|null }): ChatRequest {

    const chatOptions: ChatRequest = {
      model,
      // @ts-expect-error typing
      messages,
      options: {}
    }
    if (opts?.contextWindowSize) {
      chatOptions.options!.num_ctx = opts.contextWindowSize
    }
    if (opts?.maxTokens) {
      chatOptions.options!.num_predict = opts.maxTokens
    }
    if (opts?.temperature) {
      chatOptions.options!.temperature = opts.temperature
    }
    if (opts?.top_k) {
      chatOptions.options!.top_k = opts.top_k
    }
    if (opts?.top_p) {
      chatOptions.options!.top_p = opts.top_p
    }
    if (Object.keys(opts || {}).length === 0) {
      delete chatOptions.options
    }
    return chatOptions
  }

  async getToolOpts(model: string, opts?: LlmCompletionOpts): Promise<Omit<ChatRequest, 'model'>> {

    // disabled?
    if (opts?.tools === false || !this.modelSupportsTools(model)) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    return tools.length ? {
      tools: tools,
      //tool_choice: 'auto',
    } : {}

  }

  async stop() {
    await this.client.abort()
  }

  async *nativeChunkToLlmChunk(chunk: ChatResponse, context: OllamaStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // debug
    // console.dir(chunk, { depth: null })

    // add usage
    if (chunk.done && context.usage && (chunk.eval_count || chunk.prompt_eval_count)) {
      context.usage.prompt_tokens += chunk.prompt_eval_count
      context.usage.completion_tokens += chunk.eval_count
    }

    // tool calls
    if (chunk.message.tool_calls?.length) {

      // debug
      // console.log('tool calls', JSON.stringify(chunk.message.tool_calls))

      // iterate on each tool
      for (const tool of chunk.message.tool_calls) {

        // record the tool call
        const toolCall: LlmToolCall = {
          id: `${context.toolCalls.length}`,
          message: tool,
          function: tool.function.name,
          args: JSON.stringify(tool.function.arguments || ''),
        }
        context.toolCalls.push(toolCall)

        // first notify prep
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // log
        logger.log(`[ollama] tool call ${toolCall.function} with ${tool}`)
        const args = JSON.parse(toolCall.args)

        // now notify running
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function, args),
          done: false
        }

        // now execute
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[ollama] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool response message
        context.thread.push({
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
        stream: await this.doStream(context),
      }

      // done
      return

    }

    // <think/> toggles thinking
    if (chunk.message.content === '<think>') {
      context.thinking = true
      return
    } else if (chunk.message.content === '</think>') {
      context.thinking = false
      return
    }
    
    // content
    yield {
      type: context.thinking ? 'reasoning' : 'content',
      text: chunk.message.content || '',
      done: chunk.done
    }

    // usage
    if (context.opts.usage && context.usage && chunk.done) {
      yield {
        type: 'usage',
        usage: context.usage
      }
    } 
  
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(message: Message, payload: LLmCompletionPayload, opts: LlmCompletionOpts) {
    if (message.attachment) {
      payload.images = [ message.attachment.content ]
    }
  }

}
