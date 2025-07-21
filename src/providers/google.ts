
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelGoogle } from '../types/index'
import { LLmCompletionPayload, LLmContentPayloadText, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCallInfo } from '../types/llm'
import Attachment from '../models/attachment'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import { zeroUsage } from '../usage'
import Message from '../models/message'
import logger from '../logger'

import { Content, FunctionCallingConfigMode, FunctionDeclaration, FunctionResponse, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, Part, Schema, Type } from '@google/genai'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { minimatch } from 'minimatch'

//
// https://ai.google.dev/gemini-api/docs
//

type GoogleCompletionOpts = LlmCompletionOpts & {
  instruction?: string
}

export type GoogleStreamingContext = Omit<LlmStreamingContextTools, 'thread'> & {
  opts: GoogleCompletionOpts
  content: Content[]
}

export default class extends LlmEngine {

  client: GoogleGenAI

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new GoogleGenAI({
      apiKey: config.apiKey!,
    })
  }

  getId(): string {
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

    if (!model.name) {
      return {
        tools: true,
        vision: false,
        reasoning: false,
        caching: false,
      }
    }
    
    const modelName = model.name.replace('models/', '')

    return {
      tools: !modelName.includes('gemma') && !modelName.includes('dialog') && !modelName.includes('tts'),
      vision: visionGlobs.some((m) => minimatch(modelName, m)) && !excludeVisionGlobs.some((m) => minimatch(modelName, m)),
      reasoning: reasoningGlobs.some((m) => minimatch(modelName, m)),
      caching: false,
    }
    
  }

  async getModels(): Promise<ModelGoogle[]> {

    // need an api key
    if (!this.config.apiKey) {
      return []
    }

    // fpr debugging purposes
    // const actions = new Set<string>()

    // we may have to iterate over multiple pages
    const models: ModelGoogle[] = []
    const pager = await this.client.models.list()
    for await (const model of pager) {
      // model.supportedActions?.forEach((action) => actions.add(action))
      if (!model.name) continue
      //if (model.name.match(/\d\d\d$/)) continue
      if (model.name.includes('tuning')) continue
      if (model.description?.includes('deprecated')) continue
      if (model.description?.includes('discontinued')) continue
      models.push(model as ModelGoogle)
    }

    // debugging
    //console.log(actions)

    // reverse
    models.reverse()

    // done
    return models
    
  }

  async complete(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {
    const messages = this.threadToHistory(thread, model, opts)
    const instruction = this.getInstructions(model, thread)
    return await this.chat(model, messages, {
      ...opts,
      instruction
    })
  }

  async chat(model: ChatModel, thread: Content[], opts?: GoogleCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    
    // call
    logger.log(`[google] prompting model ${model.id}`)
    const response = await this.client.models.generateContent({
      model: model.id,
      contents: thread,
      config: await this.getGenerationConfig(model, opts),
    })

    // check for tool calls
    const toolCalls = response.functionCalls
    if (toolCalls?.length) {

      // results
      const results: FunctionResponse[] = []

      for (const toolCall of toolCalls) {

        // need
        logger.log(`[google] tool call ${toolCall.name} with ${JSON.stringify(toolCall.args)}`)

        // now execute
        const content = await this.callTool({ model: model.id }, toolCall.name!, toolCall.args)
        logger.log(`[google] tool call ${toolCall.name} => ${JSON.stringify(content).substring(0, 128)}`)

        results.push({
          name: toolCall.name!,
          response: content!
        })

        // save tool call info
        toolCallInfo.push({
          name: toolCall.name!,
          params: toolCall.args,
          result: content
        })

      }

      // function call
      thread.push({
        role: 'assistant',
        parts: response.candidates![0].content!.parts,
      })

      // send
      thread.push({
        role: 'tool',
        parts: results.map((r) => ({ functionResponse: r }) ),
      })

      // prompt again
      const completion = await this.chat(model, thread, opts)

      // prepend tool call info
      completion.toolCalls = [
        ...toolCallInfo,
        ...completion.toolCalls ?? [],
      ]

      // cumulate usage
      if (opts?.usage && response.usageMetadata && completion.usage) {
        completion.usage.prompt_tokens += response.usageMetadata.promptTokenCount ?? 0
        completion.usage.completion_tokens += response.usageMetadata.candidatesTokenCount ?? 0
      }

      // done
      return completion

    }

    // done
    return {
      type: 'text',
      content: response.text,
      toolCalls: toolCallInfo,
      ...(opts?.usage && response.usageMetadata ? { usage: {
        prompt_tokens: response.usageMetadata.promptTokenCount ?? 0,
        completion_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
      } } : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // context
    const context: GoogleStreamingContext = {
      model: model,
      content: this.threadToHistory(thread, model, opts),
      opts: {
        ...opts,
        instruction: this.getInstructions(model, thread),
      },
      toolCalls: [],
      usage: zeroUsage()
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

    logger.log(`[google] prompting model ${context.model.id}`)
    const response = await this.client.models.generateContentStream({
      model: context.model.id,
      contents: context.content,
      config: await this.getGenerationConfig(context.model, context.opts),
    })

    // done
    return response

  }

  private supportsInstructions(model: ChatModel): boolean {
    return ['gemini'].some((m) => model.id.includes(m))
  }

  private supportsStructuredOutput(model: ChatModel): boolean {
    return ['gemini'].some((m) => model.id.includes(m))
  }

  private getInstructions(model: ChatModel, thread: Message[]): string|undefined {
    return (this.supportsInstructions(model) && thread.length > 1 && thread[0].role === 'system') ? thread[0].content : undefined  
  }

  private typeToSchemaType(type: string, properties?: any): Type {
    if (type === 'string') return Type.STRING
    if (type === 'number') return Type.NUMBER
    if (type === 'boolean') return Type.BOOLEAN
    if (type === 'array') return Type.ARRAY
    return properties ? Type.OBJECT : Type.STRING
  }

  private async getGenerationConfig(model: ChatModel, opts?: GoogleCompletionOpts): Promise<GenerateContentConfig|undefined> {

    const config: GenerateContentConfig = {
      ...(opts?.maxTokens ? { maxOutputTokens: opts?.maxTokens } : {} ),
      ...(opts?.temperature ? { temperature: opts?.temperature } : {} ),
      ...(opts?.top_k ? { topK: opts?.top_k } : {} ),
      ...(opts?.top_p ? { topP: opts?.top_p } : {} ),
    }

    // add instructions
    if (opts?.instruction) {
      config.systemInstruction = opts!.instruction
    }

    // add structured output
    if (this.supportsStructuredOutput(model) && opts?.structuredOutput) {
      config.responseMimeType = 'application/json'
      config.responseJsonSchema = zodToJsonSchema(opts.structuredOutput.structure)
    }

    // add tools
    if (opts?.tools !== false && model.capabilities.tools) {

      const tools = await this.getAvailableTools();
      if (tools.length) {
      
        const functionDeclarations: FunctionDeclaration[] = [];

        for (const tool of tools) {

          const googleProps: { [k: string]: Schema } = {};
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
            } as Schema
          }

          functionDeclarations.push({
            name: tool.function.name,
            description: tool.function.description,
            ...(Object.keys(tool.function.parameters.properties).length == 0 ? {} : {
              parameters: {
                type: Type.OBJECT,
                properties: googleProps,
                required: tool.function.parameters!.required,
              }
            })
          })
        }

        // done
        config.tools = [{ functionDeclarations: functionDeclarations }]

        // tool call options
        if (opts?.toolChoice?.type === 'none') {
          config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.NONE } }
        } else if (opts?.toolChoice?.type === 'required') {
          config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
        } else if (opts?.toolChoice?.type === 'tool') {
          config.toolConfig = { functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [ opts.toolChoice.name! ]
          }}
        } else {
          config.toolConfig = { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }
        }

      }
    }

    // done
    return Object.keys(config).length ? config : undefined
  }

  threadToHistory(thread: Message[], model: ChatModel, opts?: LlmCompletionOpts): Content[] {
    const supportsInstructions = this.supportsInstructions(model)
    const payload = this.buildPayload(model, thread.filter((m) => supportsInstructions ? m.role !== 'system' : true), opts).map((p) => {
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
      content.parts!.push({
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
   
  async *nativeChunkToLlmChunk(chunk: GenerateContentResponse, context: GoogleStreamingContext): AsyncGenerator<LlmChunk, void, void> {

    // debug
    // logger.log('[google] chunk', JSON.stringify(chunk))

    // usage
    if (context.opts.usage && chunk.usageMetadata) {
      context.usage.prompt_tokens += chunk.usageMetadata.promptTokenCount ?? 0
      context.usage.completion_tokens += chunk.usageMetadata.candidatesTokenCount ?? 0
    }

    // tool calls
    const toolCalls = chunk.functionCalls
    if (toolCalls?.length) {

      // save
      context.toolCalls = toolCalls.filter(tc => tc.name).map((tc) => {
        return {
          id: tc.id || tc.name!,
          message: '',
          function: tc.name!,
          args: JSON.stringify(tc.args),
        }
      })

      // results
      const results: FunctionResponse[] = []

      // call
      for (const toolCall of context.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          id: toolCall.id,
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
          id: toolCall.id,
          name: toolCall.function,
          status: this.getToolRunningDescription(toolCall.function, args),
          call: {
            params: args,
            result: undefined
          },
          done: false
        }

        // now execute
        const content = await this.callTool({ model: context.model.id }, toolCall.function, args)
        logger.log(`[google] tool call ${toolCall.function} => ${JSON.stringify(content).substring(0, 128)}`)

        // send
        results.push({
          id: toolCall.id,
          name: toolCall.function,
          response: content
        })

        // clear
        yield {
          type: 'tool',
          id: toolCall.id,
          name: toolCall.function,
          status: this.getToolCompletedDescription(toolCall.function, args, content),
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
        parts: chunk.candidates![0].content!.parts,
      })

      // send
      context.content.push({
        role: 'tool',
        parts: results.map((r) => ({ functionResponse: r }) ),
      })

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

    // text chunk
    const done = !!chunk.candidates?.[0].finishReason
    yield {
      type: 'content',
      text: chunk.text || '',
      done: done
    }

    // usage
    if (done && context.opts.usage) {
      yield { type: 'usage', usage: context.usage }
    }
  }

   
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(attachment: Attachment, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {
    if (!payload.images) payload.images = []
    payload.images.push(attachment!.content)
  }

}
