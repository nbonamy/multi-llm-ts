import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'
import Attachment from '../models/attachment'
import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelOllama, ModelsList } from '../types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo, LlmUsage } from '../types/llm'
import { PluginExecutionResult } from '../types/plugin'

import { minimatch } from 'minimatch'
import { ChatRequest, ChatResponse, Ollama, ProgressResponse, ShowResponse } from 'ollama/dist/browser.cjs'
import type { A as AbortableAsyncIterator } from 'ollama/dist/shared/ollama.27169772.cjs'
import { zodToJsonSchema } from 'zod-to-json-schema'

export type OllamaStreamingContext = LlmStreamingContextTools & {
  usage: LlmUsage
  thinking: boolean
}

export type OllamaModelInfo = {
  details: {
    family: string
  }
  model_info: Record<string, any>
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

  getId(): string {
    return 'ollama'
  }
  
  getModelCapabilities(model: ModelOllama): ModelCapabilities {
    
    const toolModels = [
      'athene-v2',
      'aya-expanse',
      'cogito',
      'command-a',
      'command-r',
      'command-r-plus',
      'command-r7b',
      'command-r7b-arabic',
      'deepseek-r1',
      'deepseek-v3.1',
      'devstral',
      'firefunction-v2',
      'gpt-oss',
      'gpt-oss-safeguard',
      'granite3-dense',
      'granite3-moe',
      'granite3.1-dense',
      'granite3.1-moe',
      'granite3.2',
      'granite3.2-vision',
      'granite3.3',
      'granite4',
      'hermes3',
      'llama3-groq-tool-use',
      'llama3.1',
      'llama3.2',
      'llama3.3',
      'llama4',
      'magistral',
      'mistral',
      'mistral-large',
      'mistral-nemo',
      'mistral-small',
      'mistral-small3.1',
      'mistral-small3.2',
      'mixtral',
      'nemotron',
      'nemotron-mini',
      'phi4-mini',
      'qwen2',
      'qwen2.5',
      'qwen2.5-coder',
      'qwen3',
      'qwq',
      'smollm2',
    ]

    const visionModels = [
      'bakllava',
      'gemma3',
      'granite3.2-vision',
      'llama3.2-vision',
      'llama4',
      'llava',
      'llava-llama3',
      'llava-phi3',
      'minicpm-v',
      'mistral-small3.1',
      'mistral-small3.2',
      'moondream',
      'qwen2.5vl',
      'qwen3-vl',
    ]

    const reasoningModels = [
      'cogito:*',
      'deepseek-r1:*',
      'deepseek-v3.1:*',
      'gpt-oss:*',
      'gpt-oss-safeguard:*',
      'magistral:*',
      'openthinker:*',
      'phi:*',
      'qwq:*',
      'qwen3:*',
    ]

    return {
      tools: toolModels.includes(model.name.split(':')[0]),
      vision: visionModels.some((m) => model.name.match(m)),
      reasoning: reasoningModels.some((m) => minimatch(model.name, m)),
      caching: false,
    }

  }

  async getModels(): Promise<ModelOllama[]> {
    try {
      const response = await this.client.list()
      return response.models
    } catch (error) {
      console.error('Error listing models:', error);
      return [] 
    }
  }

  async getModelInfo(model: string): Promise<ShowResponse|null> {
    try {
      return await this.client.show({ model: model })
    } catch (error) {
      console.error('Error listing models:', error);
      return null
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

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[ollama] prompting model ${model.id}`)
    const response = await this.client.chat({
      ...this.buildChatOptions({
        model: model.id,
        messages: thread,
        opts: opts || null,
      }),
      ...await this.getToolOpts(model, opts || {}),
      stream: false,
    })

    // tool class
    if (response.message.tool_calls?.length) {

      // iterate on each tool
      for (const toolCall of response.message.tool_calls) {

        // log
        logger.log(`[ollama] tool call ${toolCall.function.name} with ${JSON.stringify(toolCall.function.arguments)}`)

        // now execute
        let lastUpdate: PluginExecutionResult|undefined = undefined
        for await (const update of this.callTool({ model: model.id, abortSignal: opts?.abortSignal }, toolCall.function.name, toolCall.function.arguments, opts?.toolExecutionValidation)) {
          if (update.type === 'result') {
            lastUpdate = update
          }
        }

        // process result
        const { content, canceled } = this.processToolExecutionResult('ollama', toolCall.function.name, toolCall.function.arguments, lastUpdate)

        // if canceled/denied, stop processing
        if (canceled) {
          throw new Error('Tool execution was canceled')
        }

        // add tool call message
        thread.push(response.message)

        // add tool response message
        thread.push({
          role: 'tool',
          content: JSON.stringify(content)
        })

        // save tool call info
        toolCallInfo.push({
          name: toolCall.function.name,
          params: toolCall.function.arguments,
          result: content
        })
      }

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // prepend tool call info
      completion.toolCalls = [
        ...toolCallInfo,
        ...completion.toolCalls ?? [],
      ]

      // cumulate usage
      if (opts?.usage && completion.usage) {
        completion.usage.prompt_tokens += response.prompt_eval_count ?? 0
        completion.usage.completion_tokens += response.eval_count ?? 0
      }

      // done
      return completion

    }

    // return an object
    return {
      type: 'text',
      content: response.message.content,
      toolCalls: toolCallInfo,
      ...(opts?.usage ?  { usage: {
        prompt_tokens: response.prompt_eval_count,
        completion_tokens: response.eval_count,
      } } : {})
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

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
    logger.log(`[ollama] prompting model ${context.model.id}`)
    const stream = this.client.chat({
      ...this.buildChatOptions({
        model: context.model.id,
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
    if (opts?.structuredOutput) {
      chatOptions.format = zodToJsonSchema(opts.structuredOutput.structure, { name: opts.structuredOutput.name })
    }
    if (Object.keys(opts || {}).length === 0) {
      delete chatOptions.options
    }
    return chatOptions
  }

  async getToolOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<ChatRequest, 'model'>> {

    // disabled?
    if (opts?.tools === false || !model.capabilities.tools) {
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

  async *nativeChunkToLlmChunk(chunk: ChatResponse, context: OllamaStreamingContext): AsyncGenerator<LlmChunk> {

    // debug
    // console.dir(chunk, { depth: null })

    // add usage
    if (chunk.done && (chunk.eval_count || chunk.prompt_eval_count)) {
      context.usage.prompt_tokens += chunk.prompt_eval_count ?? 0
      context.usage.completion_tokens += chunk.eval_count ?? 0
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
          id: toolCall.id,
          name: toolCall.function,
          state: 'preparing',
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // log
        logger.log(`[ollama] tool call ${toolCall.function} with ${tool}`)
        const args = JSON.parse(toolCall.args)

        try {
          // now notify running
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.function,
            state: 'running',
            status: this.getToolRunningDescription(toolCall.function, args),
            call: {
              params: args,
              result: undefined
            },
            done: false
          }

          // now execute
          let lastUpdate: PluginExecutionResult|undefined = undefined
          for await (const update of this.callTool({ model: context.model.id, abortSignal: context.opts?.abortSignal }, toolCall.function, args, context.opts?.toolExecutionValidation)) {

            if (update.type === 'status') {
              yield {
                type: 'tool',
                id: toolCall.id,
                name: toolCall.function,
                state: 'running',
                status: update.status,
                call: {
                  params: args,
                  result: undefined
                },
                done: false
              }

            } else if (update.type === 'result') {
              lastUpdate = update
            }

          }

          // process result
          const { content, canceled: toolCallCanceled } = this.processToolExecutionResult('ollama', toolCall.function, args, lastUpdate)

          // done
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.function,
            state: toolCallCanceled ? 'canceled' : 'completed',
            status: toolCallCanceled
              ? this.getToolCanceledDescription(toolCall.function, args) || content.error || 'Tool execution was canceled'
              : this.getToolCompletedDescription(toolCall.function, args, content),
            done: true,
            call: {
              params: args,
              result: content
            }
          }

          // add tool call message
          context.thread.push(chunk.message)

          // add tool response message
          context.thread.push({
            role: 'tool',
            content: JSON.stringify(content)
          })

          // Check if canceled
          if (context.opts?.abortSignal?.aborted) {
            return  // Stop processing
          }

        } catch (error) {
          // Check if this was an abort
          if (context.opts?.abortSignal?.aborted) {
            yield {
              type: 'tool',
              id: toolCall.id,
              name: toolCall.function,
              state: 'canceled',
              status: this.getToolCanceledDescription(toolCall.function, args),
              done: true,
              call: {
                params: args,
                result: undefined
              }
            }
            return  // Stop processing
          }
          throw error  // Re-throw non-abort errors
        }

      }

      // clear force tool call to avoid infinite loop
      if (context.opts.toolChoice?.type === 'tool') {
        delete context.opts.toolChoice
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

    // thinking can be in chunk too
    if (chunk.message.thinking?.length) {
      yield {
        type: 'reasoning',
        text: chunk.message.thinking,
        done: chunk.done
      }
    }
    
    // content
    if (chunk.message.content?.length || chunk.done) {
      yield {
        type: context.thinking ? 'reasoning' : 'content',
        text: chunk.message.content || '',
        done: chunk.done
      }
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
  requiresFlatTextPayload(msg: Message): boolean {
    return true
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts: LlmCompletionOpts) {
    if (!payload.images) payload.images = []
    payload.images.push(attachment!.content)
  }

}
