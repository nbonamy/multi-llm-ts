
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelGoogle } from '../types/index'
import { LLmCompletionPayload, LLmContentPayloadText, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCall, LlmToolCallInfo } from '../types/llm'
import Attachment from '../models/attachment'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import { Content, EnhancedGenerateContentResponse, GenerativeModel, GoogleGenerativeAI, ModelParams, Part, FunctionResponsePart, SchemaType, FunctionDeclarationSchemaProperty, FunctionCallingMode, GenerationConfig } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai/dist/types'
import { minimatch } from 'minimatch'

//
// https://ai.google.dev/gemini-api/docs
//

export type GoogleStreamingContext = {
  model: GenerativeModel
  content: Content[]
  opts: LlmCompletionOpts
  toolCalls: LlmToolCall[]
}

export default class extends LlmEngine {

  client: GoogleGenerativeAI

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new GoogleGenerativeAI(
      config.apiKey!,
    )
  }

  getName(): string {
    return 'google'
  }

  // https://ai.google.dev/gemini-api/docs/models/gemini

  getModelCapabilities(model: ModelGoogle): ModelCapabilities {

    const visionGlobs = [
      'gemma-3*',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-*',
      'gemini-2.0-flash-*',
      'gemini-exp-1206',
      'gemini-2.0-flash-thinking-*',
      'gemini-2.5-*',
    ]

    const excludeVisionGlobs = [
      'gemma-3-1b*',
      '*tts',
    ]

    const reasoningGlobs = [
      'gemini-2.5-flash*',
      'gemini-2.5-pro*',
      '*thinking*',
    ]
    
    const modelName = model.name.replace('models/', '')

    return {
      tools: !modelName.includes('tts'),
      vision: visionGlobs.some((m) => minimatch(modelName, m)) && !excludeVisionGlobs.some((m) => minimatch(modelName, m)),
      reasoning: reasoningGlobs.some((m) => minimatch(modelName, m)),
    }
    
  }

  async getModels(): Promise<ModelGoogle[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // https://ai.google.dev/api/models#models_get-SHELL
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.client.apiKey}`)
    const json = await response.json()

    // filter
    const models: ModelGoogle[] = []
    for (const model of json.models) {
      if (model.name?.match(/\d\d\d$/)) continue
      if (model.name?.includes('tuning')) continue
      if (model.description?.includes('deprecated')) continue
      if (model.description?.includes('discontinued')) continue
      models.push(model)
    }

    // reverse
    models.reverse()

    // // remove duplicated based on name
    // const names: string[] = []
    // const filtered = []
    // for (const model of models) {
    //   if (names.includes(model.displayName)) continue
    //   names.push(model.displayName)
    //   filtered.push(model)
    // }

    // done
    return models
    
  }

  async complete(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const messages = this.threadToHistory(thread, model, opts)
    return await this.chat(model, messages, opts)
  }

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[google] prompting model ${model.id}`)
    const googleModel = await this.getModel(model, thread[0].contentForModel, opts)
    const response = await googleModel.generateContent({
      contents: thread,
      generationConfig: this.getGenerationConfig(opts),
    })

    // check for tool calls
    const toolCalls = response.response.functionCalls()
    if (toolCalls?.length) {

      // results
      const results: FunctionResponsePart[] = []

      for (const toolCall of toolCalls) {

        // need
        logger.log(`[google] tool call ${toolCall.name} with ${JSON.stringify(toolCall.args)}`)

        // now execute
        const content = await this.callTool(toolCall.name, toolCall.args)
        logger.log(`[google] tool call ${toolCall.name} => ${JSON.stringify(content).substring(0, 128)}`)

        results.push({ functionResponse: {
          name: toolCall.name,
          response: content
        }})

        // save tool call info
        toolCallInfo.push({
          name: toolCall.name,
          params: toolCall.args,
          result: content
        })

      }

      // function call
      thread.push({
        role: 'assistant',
        parts: response.response.candidates![0].content.parts,
      })

      // send
      thread.push({
        role: 'tool',
        parts: results
      })

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // prepend tool call info
      completion.toolCalls = [
        ...toolCallInfo,
        ...completion.toolCalls ?? [],
      ]

      // cumulate usage
      if (opts?.usage && response.response.usageMetadata && completion.usage) {
        completion.usage.prompt_tokens += response.response.usageMetadata.promptTokenCount
        completion.usage.completion_tokens += response.response.usageMetadata.candidatesTokenCount
      }

      // done
      return completion

    }

    // done
    return {
      type: 'text',
      content: response.response.text(),
      toolCalls: toolCallInfo,
      ...(opts?.usage && response.response.usageMetadata ? { usage: {
        prompt_tokens: response.response.usageMetadata.promptTokenCount,
        completion_tokens: response.response.usageMetadata.candidatesTokenCount,
      } } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // context
    const context: GoogleStreamingContext = {
      model: await this.getModel(model, thread[0].contentForModel, opts),
      content: this.threadToHistory(thread, model, opts),
      opts: opts || {},
      toolCalls: [],
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }

  }

  async doStream(context: GoogleStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []

    logger.log(`[google] prompting model ${context.model!.model}`)
    const response = await context.model!.generateContentStream({
      contents: context.content,
      generationConfig: this.getGenerationConfig(context.opts),
    })

    // done
    return response.stream

  }

  private modelStartsWith(model: string, prefix: string[]): boolean {
    for (const p of prefix) {
      if (model.startsWith(p)) {
        return true
      }
    }
    return false
  }

  private supportsInstructions(model: ChatModel): boolean {
    return this.modelStartsWith(model.id, ['models/gemini-pro']) == false
  }

  async getModel(model: ChatModel, instructions: string, opts?: LlmCompletionOpts): Promise<GenerativeModel> {

    // model params
    const modelParams: ModelParams = {
      model: model.id,
    }

    // add instructions
    if (this.supportsInstructions(model)) {
      modelParams.systemInstruction = instructions
    }

    // add tools
    if (opts?.tools !== false && model.capabilities.tools) {

      const tools = await this.getAvailableTools();
      if (tools.length) {
      
        const functionDeclarations: FunctionDeclaration[] = [];

        for (const tool of tools) {

          const googleProps: { [k: string]: FunctionDeclarationSchemaProperty } = {};
          for (const name of Object.keys(tool.function.parameters.properties)) {
            const props = tool.function.parameters.properties[name]
            googleProps[name] = {
              type: this.typeToSchemaType(props.type),
              description: props.description,
              ...(props.enum ? { enum: props.enum } : {}),
              ...(props.items ? { items: {
                  type: this.typeToSchemaType(props.items.type, props.items?.properties),
                  properties: props.items?.properties
                }
              } : {}),
            } as FunctionDeclarationSchemaProperty
          }

          functionDeclarations.push({
            name: tool.function.name,
            description: tool.function.description,
            ...(Object.keys(tool.function.parameters.properties).length == 0 ? {} : {
              parameters: {
                type: SchemaType.OBJECT,
                properties: googleProps,
                required: tool.function.parameters!.required,
              }
            })
          })
        }

        // done
        modelParams.toolConfig = { functionCallingConfig: { mode: FunctionCallingMode.AUTO } }
        modelParams.tools = [{ functionDeclarations: functionDeclarations }]

      }
    }

    // call
    return this.client.getGenerativeModel( modelParams, {
      apiVersion: 'v1beta'
    })
  }

  private typeToSchemaType(type: string, properties?: any): SchemaType {
    if (type === 'string') return SchemaType.STRING
    if (type === 'number') return SchemaType.NUMBER
    if (type === 'boolean') return SchemaType.BOOLEAN
    if (type === 'array') return SchemaType.ARRAY
    return properties ? SchemaType.OBJECT : SchemaType.STRING
  }

  private getGenerationConfig(opts?: LlmCompletionOpts): GenerationConfig|undefined {
    const config = {
      ...(opts?.maxTokens ? { maxOutputTokens: opts?.maxTokens } : {} ),
      ...(opts?.temperature ? { temperature: opts?.temperature } : {} ),
      ...(opts?.top_k ? { topK: opts?.top_k } : {} ),
      ...(opts?.top_p ? { topP: opts?.top_p } : {} ),
    }
    return Object.keys(config).length ? config : undefined
  }

  threadToHistory(thread: Message[], model: ChatModel, opts?: LlmCompletionOpts): Content[] {
    const hasInstructions = this.supportsInstructions(model)
    const payload = this.buildPayload(model, thread.slice(hasInstructions ? 1 : 0), opts).map((p) => {
      if (p.role === 'system') p.role = 'user'
      return p
    })
    return payload.map((message) => this.messageToContent(message))
  }

  messageToContent(payload: LLmCompletionPayload): Content {
    const content: Content = {
      role: payload.role == 'assistant' ? 'model' : payload.role,
      parts: Array.isArray(payload.content) ? payload.content.map((c) => ({ text: (c as LLmContentPayloadText).text })) : [ { text: payload.content as string } ],
    }
    for (const index in payload.images) {
      content.parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: payload.images[Number(index)],
        }
      })
    }
    return content
  }

  addAttachment(parts: Array<string|Part>, attachment: Attachment) {

    // load if no contents
    if (attachment.content === null || attachment.content === undefined) {
      console.warn('[google] attachment contents not available. Skipping attachment.')
    }
  
    // add inline
    if (attachment.isImage()) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.content,
        }
      })
    } else if (attachment.isText()) {
      parts.push(attachment.content)
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async stop(stream: LlmStream) {
    //await stream?.controller?.abort()
  }
   
  async *nativeChunkToLlmChunk(chunk: EnhancedGenerateContentResponse, context: GoogleStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // debug
    // logger.log('[google] chunk', JSON.stringify(chunk))

    // tool calls
    const toolCalls = chunk.functionCalls()
    if (toolCalls?.length) {

      // save
      context.toolCalls = toolCalls.map((tc) => {
        return {
          id: tc.name,
          message: '',
          function: tc.name,
          args: JSON.stringify(tc.args),
        }
      })

      // results
      const results: FunctionResponsePart[] = []

      // call
      for (const toolCall of context.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

        // need
        logger.log(`[google] tool call ${toolCall.function} with ${toolCall.args}`)
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
        logger.log(`[google] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // send
        results.push({ functionResponse: {
          name: toolCall.function,
          response: content
        }})

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

      // function call
      context.content.push({
        role: 'assistant',
        parts: chunk.candidates![0].content.parts,
      })

      // send
      context.content.push({
        role: 'tool',
        parts: results
      })

      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(context),
      }
      
      // done
      return

    }

    // text chunk
    const done = !!chunk.candidates?.[0].finishReason
    yield {
      type: 'content',
      text: chunk.text() || '',
      done: done
    }

    // usage
    if (done && context.opts.usage && chunk.usageMetadata) {
      yield { type: 'usage', usage: {
        prompt_tokens: chunk.usageMetadata.promptTokenCount,
        completion_tokens: chunk.usageMetadata.candidatesTokenCount,
      }}
    }
  }

   
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {
    if (!payload.images) payload.images = []
    payload.images.push(attachment!.content)
  }

}
