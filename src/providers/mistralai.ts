/* eslint-disable @typescript-eslint/no-unused-vars */
import { EngineConfig } from 'types/index.d'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm.d'
import Message from '../models/message'
import LlmEngine from '../engine'

import { Mistral } from '@mistralai/mistralai'
import { AssistantMessage, CompletionEvent, SystemMessage, ToolMessage, UserMessage } from '@mistralai/mistralai/models/components'

type MistralNessages = Array<
| (SystemMessage & { role: "system" })
| (UserMessage & { role: "user" })
| (AssistantMessage & { role: "assistant" })
| (ToolMessage & { role: "tool" })
>

export default class extends LlmEngine {

  client: Mistral
  currentModel: string
  currentThread: MistralNessages
  toolCalls: LlmToolCall[]

  constructor(config: EngineConfig) {
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

  async getModels(): Promise<any[]> {

    // need an api key
    if (!this.client.options$.apiKey) {
      return null
    }

    // do it
    try {
      const response = await this.client.models.list()
      return response.data
    } catch (error) {
      console.error('Error listing models:', error);
    }
  }

  async complete(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    const model = opts?.model || this.config.model.chat
    console.log(`[mistralai] prompting model ${model}`)
    const response = await this.client.chat.complete({
      model: model,
      messages: this.buildPayload(thread, model),
    });

    // return an object
    return {
      type: 'text',
      content: response.choices[0].message.content
    }
  }

  async stream(thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(thread, opts?.model || this.getChatModel())
  
    // save the message thread
    this.currentThread = this.buildPayload(thread, this.currentModel)
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    // tools
    const tools = await this.getAvailableToolsForModel(this.currentModel)

    // call
    console.log(`[mistralai] prompting model ${this.currentModel}`)
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
        //console.log('[mistralai] tool call start:', chunk)

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
        console.log('[mistralai] tool call:', toolCall)
        this.toolCalls.push(toolCall)

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // done
        return null

      } else {

        const toolCall = this.toolCalls[this.toolCalls.length-1]
        toolCall.args += chunk.data.choices[0].delta.toolCalls[0].function.arguments
        return null

      }

    }

    // now tool calling
    if (chunk.data.choices[0]?.finishReason === 'tool_calls') {

      // debug
      //console.log('[mistralai] tool calls:', this.toolCalls)

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
        console.log(`[mistralai] tool call ${toolCall.function} with ${JSON.stringify(args)} => ${JSON.stringify(content).substring(0, 128)}`)

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
  }

  addImageToPayload(message: Message, payload: LLmCompletionPayload) {
    payload.images = [ message.attachment.contents ]
  }

   
  async image(prompt: string, opts?: LlmCompletionOpts): Promise<LlmResponse|null> {
    return null    
  }

  async getAvailableToolsForModel(model: string): Promise<any[]> {
    if (model.includes('mistral-large') || model.includes('mixtral-8x22b')) {
      return await this.getAvailableTools()
    } else {
      return []
    }
  }
}
