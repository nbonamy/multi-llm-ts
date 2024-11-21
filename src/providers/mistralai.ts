
import { EngineCreateOpts, Model } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import { Mistral } from '@mistralai/mistralai'
import { AssistantMessage, CompletionEvent, SystemMessage, ToolMessage, UserMessage } from '@mistralai/mistralai/models/components'

type MistralMessages = Array<
| (SystemMessage & { role: "system" })
| (UserMessage & { role: "user" })
| (AssistantMessage & { role: "assistant" })
| (ToolMessage & { role: "tool" })
>

export default class extends LlmEngine {

  client: Mistral
  currentModel: string = ''
  currentThread: MistralMessages = []
  currentOpts: LlmCompletionOpts|null = null
  toolCalls: LlmToolCall[] = []

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new Mistral({
      apiKey: config.apiKey || ''
    })
  }

  getName(): string {
    return 'mistralai'
  }

  getVisionModels(): string[] {
    return []
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.options$.apiKey) {
      return []
    }

    // do it
    try {
      const response = await this.client.models.list()
      return (response.data ?? []).map((model: any) => {
        return {
          id: model.id,
          name: model.id,
          meta: model,
        }
      })
    } catch (error) {
      console.error('Error listing models:', error);
      return []
    }
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    logger.log(`[mistralai] prompting model ${model}`)
    const response = await this.client.chat.complete({
      model: model,
      messages: this.buildPayload(model, thread) as MistralMessages,
    });

    // return an object
    return {
      type: 'text',
      content: response.choices?.[0].message.content || '',
      ...(opts?.usage ? { usage: {
        prompt_tokens: response.usage.promptTokens,
        completion_tokens: response.usage.completionTokens,
      } } : {}),
    }
  }

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(model, thread, opts)
  
    // save the message thread
    this.currentThread = this.buildPayload(this.currentModel, thread) as MistralMessages

    // save opts and run
    this.currentOpts = opts || null
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    // tools
    const tools = await this.getAvailableToolsForModel(this.currentModel)

    // call
    logger.log(`[mistralai] prompting model ${this.currentModel}`)
    const stream = this.client.chat.stream({
      model: this.currentModel,
      messages: this.currentThread,
      ...(tools && {
        tools: tools,
        toolChoice: 'auto',
      }),
    })

    // done
    return stream

  }

   
  async stop() {
  }

   
  async *nativeChunkToLlmChunk(chunk: CompletionEvent): AsyncGenerator<LlmChunk, void, void> {

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
        logger.log('[mistralai] tool call:', toolCall)
        this.toolCalls.push(toolCall)

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // done
        return

      } else {

        const toolCall = this.toolCalls[this.toolCalls.length-1]
        toolCall.args += chunk.data.choices[0].delta.toolCalls[0].function.arguments
        return

      }

    }

    // now tool calling
    if (chunk.data.choices[0]?.finishReason === 'tool_calls') {

      // debug
      //logger.log('[mistralai] tool calls:', this.toolCalls)

      // add tools
      for (const toolCall of this.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function),
          done: false
        }

        // now execute
        const args = JSON.parse(toolCall.args)
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[mistralai] tool call ${toolCall.function} with ${JSON.stringify(args)} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool call message
        this.currentThread.push({
          role: 'assistant',
          toolCalls: toolCall.message
        })

        // add tool response message
        this.currentThread.push({
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
        stream: await this.doStream(),
      }

      // done
      return
      
    }

    // default
    yield {
      type: 'content',
      text: chunk.data.choices[0].delta.content || '',
      done: chunk.data.choices[0].finishReason != null
    }

    // usage
    if (this.currentOpts?.usage && chunk.data.usage) {
      yield {
        type: 'usage',
        usage: {
          prompt_tokens: chunk.data.usage.promptTokens,
          completion_tokens: chunk.data.usage.completionTokens,
        }
      }
    }
  }

  addAttachmentToPayload(message: Message, payload: LLmCompletionPayload) {
    if (message.attachment) {
      payload.images = [ message.attachment.content ]
    }
  }

   
  async getAvailableToolsForModel(model: string): Promise<any[]> {
    if (model.includes('mistral-large') || model.includes('mixtral-8x22b')) {
      return await this.getAvailableTools()
    } else {
      return []
    }
  }
}
