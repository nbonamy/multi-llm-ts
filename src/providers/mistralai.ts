import { Mistral } from '@mistralai/mistralai'
import { AssistantMessage, ChatCompletionStreamRequest, CompletionEvent, SystemMessage, ToolMessage, UserMessage } from '@mistralai/mistralai/models/components'
import LlmEngine from '../engine'
import logger from '../logger'
import Attachment from '../models/attachment'
import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMistralAI } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LLmCompletionPayload, LlmResponse, LlmStream, LlmStreamingContext, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import { PluginExecutionResult } from '../types/plugin'
import { zeroUsage } from '../usage'

type MistralMessages = Array<
| (SystemMessage & { role: "system" })
| (UserMessage & { role: "user" })
| (AssistantMessage & { role: "assistant" })
| (ToolMessage & { role: "tool" })
>

//
// https://docs.mistral.ai/api/
//

export type MistralStreamingContext = LlmStreamingContext & {
  thread: any[]  // MistralMessages
}

export default class extends LlmEngine {

  client: Mistral

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new Mistral({
      apiKey: config.apiKey || ''
    })
  }

  getId(): string {
    return 'mistralai'
  }

  getModelCapabilities(model: ModelMistralAI): ModelCapabilities {
    return {
      tools: model.capabilities?.functionCalling ?? false,
      vision: model.capabilities?.vision ?? false,
      reasoning: model.id.includes('magistral'),
      caching: false,
    }
  }

  async getModels(): Promise<ModelMistralAI[]> {

    // need an api key
    // if (!this.client.options$.apiKey) {
    //   return []
    // }

    // do it
    try {
      const models =  await this.client.models.list()
      return models.data ?? []
    } catch (error) {
      console.error('Error listing models:', error);
      return []
    }
  }

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[mistralai] prompting model ${model.id}`)
    const response = await this.client.chat.complete({
      model: model.id,
      messages: thread as MistralMessages,
      ...this.getCompletionOpts(model, opts),
      ...await this.getToolOpts(model, opts),
    });

    // get choice
    const choice = response.choices?.[0]

    // tool call
    if (choice?.finishReason === 'tool_calls') {

      const toolCalls = choice.message.toolCalls!
      for (const toolCall of toolCalls) {

        // log
        logger.log(`[mistralai] tool call ${toolCall.function.name} with ${toolCall.function.arguments}`)

        // now execute
        let lastUpdate: PluginExecutionResult|undefined = undefined
        for await (const update of this.callTool({ model: model.id, abortSignal: opts?.abortSignal }, toolCall.function.name, toolCall.function.arguments, opts?.toolExecutionValidation)) {
          if (update.type === 'result') {
            lastUpdate = update
          }
        }

        // process result
        const { content, canceled } = this.processToolExecutionResult(
          'mistralai',
          toolCall.function.name,
          toolCall.function.arguments,
          lastUpdate
        )

        // For non-streaming, throw immediately on cancel
        if (canceled) {
          throw new Error('Tool execution was canceled')
        }

        // add tool call message
        thread.push(choice.message)

        // add tool response message
        thread.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
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
      if (opts?.usage && response.usage && completion.usage) {
        completion.usage.prompt_tokens += response.usage.promptTokens ?? 0
        completion.usage.completion_tokens += response.usage.completionTokens ?? 0
      }

      // done
      return completion
    
    }    

    // return an object
    return {
      type: 'text',
      content: response.choices?.[0].message.content as string || '',
      toolCalls: toolCallInfo,
      ...(opts?.usage ? { usage: {
        prompt_tokens: response.usage.promptTokens ?? 0,
        completion_tokens: response.usage.completionTokens ?? 0,
      } } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)
  
    // context
    const context: MistralStreamingContext = {
      model: model,
      thread: this.buildPayload(model, thread, opts) as MistralMessages,
      opts: opts || {},
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      usage: zeroUsage(),
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }

  }

  async doStream(context: MistralStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []

    // call
    logger.log(`[mistralai] prompting model ${context.model.id}`)
    const stream = this.client.chat.stream({
      model: context.model.id,
      messages: context.thread,
      ...this.getCompletionOpts(context.model, context.opts),
      ...await this.getToolOpts(context.model, context.opts),
    })

    // done
    return stream

  }

  getCompletionOpts(model: ChatModel, opts?: LlmCompletionOpts): Omit<ChatCompletionStreamRequest, 'model'|'messages'|'stream'> {
    return {
      maxTokens: opts?.maxTokens,
      temperature: opts?.temperature,
      topP: opts?.top_p,
      ...(opts?.structuredOutput ? { responseFormat: { type: 'json_object' } } : {} ),
    }
  }

  async getToolOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<ChatCompletionStreamRequest, 'model'|'messages'|'stream'>> {

    // disabled?
    if (opts?.tools === false || !model.capabilities?.tools) {
      return {}
    }

    // tools
    const tools = await this.getAvailableTools()
    return tools.length ? {
      tools: tools,
      toolChoice: opts?.toolChoice?.type === 'tool' ? {
        type: 'function',
        function: { name: opts.toolChoice.name }
      } : opts?.toolChoice?.type ?? 'auto',
    } : {}

  }
   
  async stop() {
  }

  syncToolHistoryToThread(context: MistralStreamingContext): void {
    // sync mutations from toolHistory back to thread
    // MistralAI thread format: { role: 'tool', tool_call_id, name, content }
    for (const entry of context.toolHistory) {
      const threadEntry = context.thread.find(
        (t: any) => t.role === 'tool' && t.toolCallId === entry.id
      )
      if (threadEntry) {
        threadEntry.content = JSON.stringify(entry.result)
      }
    }
  }

  async *nativeChunkToLlmChunk(chunk: CompletionEvent, context: MistralStreamingContext): AsyncGenerator<LlmChunk> {

    // debug
    //console.dir(chunk, { depth: null })

    // usage
    if (context.opts.usage && chunk.data.usage) {
      context.usage.prompt_tokens += chunk.data.usage.promptTokens ?? 0
      context.usage.completion_tokens += chunk.data.usage.completionTokens ?? 0
    }

    // tool calls
    if (chunk.data.choices[0]?.delta?.toolCalls) {

      // arguments or new tool?
      if (chunk.data.choices[0].delta.toolCalls[0].id) {

        // debug
        //logger.log('[mistralai] tool call start:', chunk)

        // record the tool call
        const toolCall: LlmToolCall = {
          id: chunk.data.choices[0].delta.toolCalls[0].id,
          message: chunk.data.choices[0].delta.toolCalls.map((tc: any) => {
            delete tc.index
            return tc
          }),
          function: chunk.data.choices[0].delta.toolCalls[0].function.name,
          args: chunk.data.choices[0].delta.toolCalls[0].function.arguments as string,
        }
        context.toolCalls.push(toolCall)

        // first notify
        yield {
          type: 'tool',
          id: toolCall.id,
          name: toolCall.function,
          state: 'preparing',
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

      } else {

        const toolCall = context.toolCalls[context.toolCalls.length-1]
        toolCall.args += chunk.data.choices[0].delta.toolCalls[0].function.arguments
        toolCall.message[toolCall.message.length-1].function.arguments = toolCall.args

      }

    }

    // now tool calling
    if (chunk.data.choices[0]?.finishReason === 'tool_calls') {

      // debug
      //logger.log('[mistralai] tool calls:', context.toolCalls)

      // add tools
      for (const toolCall of context.toolCalls) {

        // log
        logger.log(`[mistralai] tool call ${toolCall.function} with ${toolCall.args}`)
        const args = JSON.parse(toolCall.args)

        try {
          // first notify
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
          const { content, canceled: toolCallCanceled } = this.processToolExecutionResult(
            'mistralai',
            toolCall.function,
            args,
            lastUpdate
          )

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
          context.thread.push({
            role: 'assistant',
            toolCalls: toolCall.message
          })

          // add tool response message
          context.thread.push({
            role: 'tool',
            toolCallId: toolCall.id,
            name: toolCall.function,
            content: JSON.stringify(content)
          })

          // add to tool history
          context.toolHistory.push({
            id: toolCall.id,
            name: toolCall.function,
            args: args,
            result: content,
            round: context.currentRound,
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

      // call hook and sync tool history
      await this.callHook('beforeToolCallsResponse', context)
      this.syncToolHistoryToThread(context)

      // increment round for next iteration
      context.currentRound++

      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(context),
      }

      // done
      return
      
    }

    if (Array.isArray(chunk.data.choices[0]?.delta?.content)) {
      for (const contentPart of chunk.data.choices[0].delta.content) {
        if (contentPart.type === 'thinking') {

          let reasongingText = ''
          for (const t of contentPart.thinking) {
            if (t.type === 'text') {
              reasongingText += t.text
            }
          }

          yield {
            type: 'reasoning',
            text: reasongingText,
            done: false,
          }
        }
      }
    } else {

      // default
      yield {
        type: 'content',
        text: chunk.data.choices[0].delta.content as string || '',
        done: chunk.data.choices[0].finishReason != null
      }

    }

    // usage
    if (context.opts.usage) {
      yield { type: 'usage', usage: context.usage }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected addImageToPayload(model: ChatModel, attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {

    // if we have a string content, convert it to an array
    if (typeof payload.content === 'string') {
      payload.content = [{
        type: 'text',
        text: payload.content,
      }]
    }

    // now add the image
    if (Array.isArray(payload.content)) {
      payload.content.push({
        type: 'image_url',
        imageUrl: { url: `data:${attachment.mimeType};base64,${attachment.content}` }
      })
    }
  }

  buildPayload(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): any[] {
    
    const payload: LLmCompletionPayload[] = super.buildPayload(model, thread, opts)
    return payload.reduce((arr: any[], item: LLmCompletionPayload) => {

      if (item.role === 'assistant' && item.tool_calls) {
        arr.push({
          role: 'assistant',
          prefix: false,
          toolCalls: item.tool_calls.map((tc, index) => ({
            id: tc.id,
            index,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            }
          }))
        })
      }

      if (item.role === 'tool') {

        const message = {
          role: 'tool',
          toolCallId: item.tool_call_id!,
          name: item.name!,
          content: item.content
        }

        const index = arr.findLastIndex((m) => m.role === 'assistant')
        if (index === -1) {
          arr.push(message)
        } else {
          arr.splice(index, 0, message)
        }

        return arr
      }
      
      if (typeof item.content == 'string') {
        arr.push({
          role: item.role as 'user'|'assistant',
          content: item.content
        })
      } else {
        arr.push({
          role: item.role as 'user'|'assistant',
          content: item.content
        })
      }

      // done
      return arr

    }, [])
  }
}
