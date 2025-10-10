import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMistralAI } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LLmCompletionPayload, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import { zeroUsage } from '../usage'
import Attachment from '../models/attachment'
import logger from '../logger'

import { Mistral } from '@mistralai/mistralai'
import { AssistantMessage, ChatCompletionStreamRequest, CompletionEvent, SystemMessage, ToolMessage, UserMessage } from '@mistralai/mistralai/models/components'

type MistralMessages = Array<
| (SystemMessage & { role: "system" })
| (UserMessage & { role: "user" })
| (AssistantMessage & { role: "assistant" })
| (ToolMessage & { role: "tool" })
>

//
// https://docs.mistral.ai/api/
//

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
        let content: any = undefined
        for await (const update of this.callTool({ model: model.id, abortSignal: opts?.abortSignal }, toolCall.function.name, toolCall.function.arguments, opts?.toolExecutionValidation)) {
          if (update.type === 'result') {
            content = update.result
          }
        }

        // log
        logger.log(`[mistralai] tool call ${toolCall.function.name} => ${JSON.stringify(content).substring(0, 128)}`)

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
        completion.usage.prompt_tokens += response.usage.promptTokens
        completion.usage.completion_tokens += response.usage.completionTokens
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
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
      } } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)
  
    // context
    const context: LlmStreamingContextTools = {
      model: model,
      thread: this.buildPayload(model, thread, opts) as MistralMessages,
      opts: opts || {},
      toolCalls: [],
      usage: zeroUsage(),
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }

  }

  async doStream(context: LlmStreamingContextTools): Promise<LlmStream> {

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

   
  async *nativeChunkToLlmChunk(chunk: CompletionEvent, context: LlmStreamingContextTools): AsyncGenerator<LlmChunk> {

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
          let content: any = undefined
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
              content = update.result
            }

          }

          // Check if canceled
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

          // log
          logger.log(`[mistralai] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

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

          // clear
          yield {
            type: 'tool',
            id: toolCall.id,
            name: toolCall.function,
            state: 'completed',
            status: this.getToolCompletedDescription(toolCall.function, args, content),
            done: true,
            call: {
              params: args,
              result: content
            },
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

    // default
    yield {
      type: 'content',
      text: chunk.data.choices[0].delta.content as string || '',
      done: chunk.data.choices[0].finishReason != null
    }

    // usage
    if (context.opts.usage) {
      yield { type: 'usage', usage: context.usage }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {

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
}
