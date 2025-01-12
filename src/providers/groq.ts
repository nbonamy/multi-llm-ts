
import { EngineCreateOpts, Model } from 'types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import Groq from 'groq-sdk'
import { ChatCompletionMessageParam, ChatCompletionChunk } from 'groq-sdk/resources/chat'
import { Stream } from 'groq-sdk/lib/streaming'

export default class extends LlmEngine {

  client: Groq
  currentModel: string = ''
  currentThread: LLmCompletionPayload[] = []
  currentOpts: LlmCompletionOpts|null = null
  toolCalls: LlmToolCall[] = []

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new Groq({
      apiKey: config.apiKey || '',
      dangerouslyAllowBrowser: true,
    })
  }

  getName(): string {
    return 'groq'
  }

  // https://console.groq.com/docs/models
  getVisionModels(): string[] {
    return [ 'llama-3.2-11b-vision-preview', 'llama-3.2-90b-vision-preview' ]
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // do it
    return [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
      { id: 'llama-3.2-90b-vision-preview', name: 'Llama 3.2 90B Vision (Preview)' },
      { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision (Preview)' },
      { id: 'llama-3.2-3b-preview', name: 'Llama 3.2 3B Text (Preview)' },
      { id: 'llama-3.2-1b-preview', name: 'Llama 3.2 1B Text (Preview)' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8b' },
      { id: 'llama3-70b-8192', name: 'Llama 3 70b' },
      { id: 'llama3-8b-8192', name: 'Llama 3 8b' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7b' },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9b' },
      { id: 'gemma-7b-it', name: 'Gemma 7b' },
    ]
  }

  async complete(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    logger.log(`[Groq] prompting model ${model}`)
    const response = await this.client.chat.completions.create({
      model: model,
      messages: this.buildPayload(model, thread) as ChatCompletionMessageParam[],
    });

    // return an object
    return {
      type: 'text',
      content: response.choices?.[0].message.content || '',
      ...(opts?.usage && response.usage ? { usage: response.usage } : {}),
    }
  }

  async stream(model: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    this.currentModel = this.selectModel(model, thread, opts)
  
    // save the message thread
    this.currentThread = this.buildPayload(model, thread)

    // save opts and do it
    this.currentOpts = opts || null
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    // tools
    const tools = await this.getAvailableTools()

    // call
    logger.log(`[Groq] prompting model ${this.currentModel}`)
    const stream = this.client.chat.completions.create({
      model: this.currentModel,
      messages: this.currentThread as ChatCompletionMessageParam[],
      ...(tools.length ? {
        tools: tools,
        tool_choice: 'auto',
      } : {}),
      stream: true,
    })

    // done
    return stream

  }

  async stop(stream: Stream<any>) {
    stream.controller.abort()
  }

  async *nativeChunkToLlmChunk(chunk: ChatCompletionChunk): AsyncGenerator<LlmChunk, void, void> {

    // debug
    //logger.log('nativeChunkToLlmChunk', JSON.stringify(chunk))

    // tool calls
    if (chunk.choices[0]?.delta?.tool_calls?.[0].function) {

      // arguments or new tool?
      if (chunk.choices[0].delta.tool_calls[0].id !== null && chunk.choices[0].delta.tool_calls[0].id !== undefined) {

        // debug
        //logger.log(`[${this.getName()}] tool call start:`, chunk)

        // record the tool call
        const toolCall: LlmToolCall = {
          id: chunk.choices[0].delta.tool_calls[0].id,
          message: chunk.choices[0].delta.tool_calls.map((tc: any) => {
            delete tc.index
            return tc
          }),
          function: chunk.choices[0].delta.tool_calls[0].function.name || '',
          args: chunk.choices[0].delta.tool_calls[0].function.arguments || '',
        }
        this.toolCalls.push(toolCall)

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // done
        //return
      
      } else {

        // append arguments
        const toolCall = this.toolCalls[this.toolCalls.length-1]
        toolCall.args += chunk.choices[0].delta.tool_calls[0].function.arguments

        // done
        //return

      }

    }

    // now tool calling
    if (['tool_calls', 'function_call', 'stop'].includes(chunk.choices[0]?.finish_reason|| '') && this.toolCalls?.length) {

      // iterate on tools
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
        logger.log(`[${this.getName()}] tool call ${toolCall.function} with ${JSON.stringify(args)}`)
        const content = await this.callTool(toolCall.function, args)
        logger.log(`[${this.getName()}] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // add tool call message
        this.currentThread.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCall.message
        })

        // add tool response message
        this.currentThread.push({
          role: 'tool',
          tool_call_id: toolCall.id,
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

    // normal content
    if (['stop', 'length'].includes(chunk.choices[0].finish_reason || '')) {

      // done
      yield { type: 'content', text: '', done: true }

      // usage?
      if (this.currentOpts?.usage && chunk.x_groq?.usage) {
        yield { type: 'usage', usage: chunk.x_groq.usage }
      }
    
    } else {
      yield {
        type: 'content',
        text: chunk.choices[0].delta.content || '',
        done: false
      }
    }
  }

  addAttachmentToPayload(message: Message, payload: LLmCompletionPayload) {
    if (message.attachment) {
      payload.content = [
        { type: 'text', text: message.contentForModel },
        { type: 'image_url', image_url: { url: `data:${message.attachment.mimeType};base64,${message.attachment.content}` } }
      ]
    }
  }

  buildPayload(model: string, thread: Message[]): LLmCompletionPayload[] {

    // default
    let payload: LLmCompletionPayload[] = super.buildPayload(model, thread)
    
    // when using vision models, we cannot use a system prompt (!!)
    let hasImages = false
    for (const p of payload) {
      if (Array.isArray(p.content)) {
        for (const m of p.content) {
          if (m.type == 'image_url') {
            hasImages = true
            break
          }
        }
      }
    }

    // remove system prompt
    if (hasImages) {
      payload = payload.filter((p) => p.role != 'system')
    }

    // now return
    return payload.map((payload): LLmCompletionPayload => {
      return {
        role: payload.role,
        content: payload.content
      }
    })
  }

}
