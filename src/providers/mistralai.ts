
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelMistralAI } from '../types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import Message from '../models/message'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'

import { Mistral } from '@mistralai/mistralai'
import { AssistantMessage, ChatCompletionStreamRequest, CompletionEvent, SystemMessage, ToolMessage, UserMessage } from '@mistralai/mistralai/models/components'
import Attachment from 'models/attachment'

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

  getName(): string {
    return 'mistralai'
  }

  getModelCapabilities(model: ModelMistralAI): ModelCapabilities {
    return {
      tools: model.capabilities?.functionCalling ?? false,
      vision: model.capabilities?.vision ?? false,
      reasoning: false,
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
        const content = await this.callTool(toolCall.function.name, toolCall.function.arguments)
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
    }
  }

  async getToolOpts<T>(model: ChatModel, opts?: LlmCompletionOpts): Promise<Omit<T, 'model'|'messages'|'stream'>> {

    // disabled?
    if (opts?.tools === false || !model.capabilities?.tools) {
      return {} as T
    }

    // tools
    const tools = await this.getAvailableTools()
    return tools.length ? {
      tools: tools,
      toolChoice: 'auto',
    } as T : {} as T

  }
   
  async stop() {
  }

   
  async *nativeChunkToLlmChunk(chunk: CompletionEvent, context: LlmStreamingContextTools): AsyncGenerator<LlmChunk, void, void> {

    // debug
    //console.dir(chunk, { depth: null })

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
          name: toolCall.function,
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

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function, args),
          done: false
        }

        // now execute
        const content = await this.callTool(toolCall.function, args)
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

    // default
    yield {
      type: 'content',
      text: chunk.data.choices[0].delta.content as string || '',
      done: chunk.data.choices[0].finishReason != null
    }

    // usage
    if (context.opts.usage && chunk.data.usage) {
      yield {
        type: 'usage',
        usage: {
          prompt_tokens: chunk.data.usage.promptTokens,
          completion_tokens: chunk.data.usage.completionTokens,
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts: LlmCompletionOpts) {
    if (!payload.images) payload.images = []
    payload.images.push(attachment!.content)
  }

}
