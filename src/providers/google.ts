import { Content, Environment, FunctionCallingConfigMode, FunctionDeclaration, FunctionResponse, GenerateContentConfig, GenerateContentResponse, GoogleGenAI, Part, Schema, Type } from '@google/genai'
import { minimatch } from 'minimatch'
import { zodToJsonSchema } from 'zod-to-json-schema'
import LlmEngine from '../engine'
import logger from '../logger'
import Attachment from '../models/attachment'
import Message from '../models/message'
import { Plugin } from '../plugin'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelGoogle } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LlmCompletionPayload, LlmCompletionPayloadContent, LLmContentPayloadText, LlmResponse, LlmStream, LlmStreamingContext, LlmStreamingResponse, LlmToolCallInfo, LlmUsage } from '../types/llm'
import { PluginExecutionResult } from '../types/plugin'
import { addUsages, zeroUsage } from '../usage'

//
// https://ai.google.dev/gemini-api/docs
//

type GoogleCompletionOpts = LlmCompletionOpts & {
  instruction?: string
}

export interface GoogleComputerToolInfo {
  plugin: Plugin
  screenSize(): { width: number, height: number }
  screenNumber(): number
}

export type GoogleStreamingContext = LlmStreamingContext<Content> & {
  opts: GoogleCompletionOpts
  requestUsage: LlmUsage
  textContentBlock?: string
}

export default class extends LlmEngine {

  client: GoogleGenAI
  computerInfo: GoogleComputerToolInfo|null = null

  constructor(config: EngineCreateOpts, computerInfo: GoogleComputerToolInfo|null = null) {
    super(config)
    this.client = new GoogleGenAI({
      apiKey: config.apiKey!,
    })
    this.computerInfo = computerInfo
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
      'gemini-3-*',
    ]

    const excludeVisionGlobs = [
      'gemma-3-1b*',
      '*tts',
    ]

    const reasoningGlobs = [
      '*thinking*',
      'gemini-2.5-flash*',
      'gemini-2.5-pro*',
      'gemini-3-*',
    ]

    if (!model.name) {
      return {
        tools: true,
        vision: false,
        reasoning: false,
        caching: false,
      }
    }

    // calc
    const modelName = model.name.replace('models/', '')
    let tools = !modelName.includes('gemma') && !modelName.includes('dialog') && !modelName.includes('tts')
    let vision = visionGlobs.some((m) => minimatch(modelName, m)) && !excludeVisionGlobs.some((m) => minimatch(modelName, m))
    let reasoning = reasoningGlobs.some((m) => minimatch(modelName, m))

    // latest aliases have all
    if (modelName.endsWith('latest') && !modelName.match(/\d/)) {
      tools = true
      vision = true
      reasoning = true
    }

    // done
    return { tools, vision, reasoning, caching: false }
    
  }

  isComputerUseModel(model: string): boolean {
    return ['gemini-2.5-computer-use-preview-10-2025'].includes(model)
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
    const messages = this.buildGooglePayload(thread, model, opts)
    const instruction = this.getInstructions(model, thread)
    return await this.chat(model, messages, {
      ...opts,
      instruction
    })
  }

  async chat(model: ChatModel, thread: Content[], opts?: GoogleCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: LlmToolCallInfo[] = []
    const startTime = Date.now()

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
        let lastUpdate: PluginExecutionResult|undefined = undefined
        for await (const update of this.callTool({ model: model.id, abortSignal: opts?.abortSignal }, toolCall.name!, toolCall.args, opts?.toolExecutionValidation)) {
          if (update.type === 'result') {
            lastUpdate = update
          }
        }

        // process result using helper method
        const { content, canceled } = this.processToolExecutionResult('google', toolCall.name!, toolCall.args, lastUpdate)

        // if canceled/denied, stop processing
        if (canceled) {
          throw new Error('Tool execution was canceled')
        }

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

      // apply cooldown before next request
      await this.applyCooldown(startTime)

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
        completion.usage.completion_tokens += response.usageMetadata.toolUsePromptTokenCount ?? 0
        completion.usage.completion_tokens_details!.reasoning_tokens! += response.usageMetadata.thoughtsTokenCount ?? 0
      }

      // done
      return completion

    }

    // thought signature from reasoning if any
    const thoughtSignature = response.candidates?.[0].content?.parts?.find(p => p.thoughtSignature)?.thoughtSignature

    // done
    return {
      type: 'text',
      content: response.text,
      toolCalls: toolCallInfo,
      ...(thoughtSignature ? { thoughtSignature } : {}),
      ...(opts?.usage && response.usageMetadata ? response.usageMetadata : {}),
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse<GoogleStreamingContext>> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // add computer plugin if computer use model
    if (this.computerInfo && this.isComputerUseModel(model.id)) {
      const computerPlugin = this.plugins.find((p) => p.getName() === this.computerInfo!.plugin.getName())
      if (!computerPlugin) {
        this.plugins.push(this.computerInfo.plugin)
      }
    }

    // context
    const context: GoogleStreamingContext = {
      model: model,
      thread: this.buildGooglePayload(thread, model, opts),
      opts: {
        ...opts,
        instruction: this.getInstructions(model, thread),
      },
      toolCalls: [],
      toolHistory: [],
      currentRound: 0,
      startTime: 0,
      usage: zeroUsage(),
      requestUsage: zeroUsage()
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
    context.startTime = Date.now()
    context.requestUsage = zeroUsage()
    context.textContentBlock = undefined

    logger.log(`[google] prompting model ${context.model.id}`)
    const response = await this.client.models.generateContentStream({
      model: context.model.id,
      contents: context.thread,
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

  protected async getGenerationConfig(model: ChatModel, opts?: GoogleCompletionOpts): Promise<GenerateContentConfig|undefined> {

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

    // add reasoning
    if (model.capabilities.reasoning && typeof opts?.thinkingBudget !== 'undefined') {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: opts.thinkingBudget
      }
    }

    // add structured output
    if (this.supportsStructuredOutput(model) && opts?.structuredOutput) {
      config.responseMimeType = 'application/json'
      config.responseJsonSchema = zodToJsonSchema(opts.structuredOutput.structure)
    }

    // add computer use tool
    if (this.computerInfo && this.isComputerUseModel(model.id)) {
      config.tools = [{
        computerUse: {
          environment: Environment.ENVIRONMENT_BROWSER
        }
      }]
    }

    // add tools
    else if (opts?.tools !== false && model.capabilities.tools) {

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

  requiresFlatTextPayload(model: ChatModel, msg: Message) {
    if (msg.thoughtSignature) return false
    else return super.requiresFlatTextPayload(model, msg)
  }

  public buildGooglePayload(thread: Message[], model: ChatModel, opts?: LlmCompletionOpts): Content[] {
    const supportsInstructions = this.supportsInstructions(model)
    const payload = this.buildPayload(model, thread.filter((m) => supportsInstructions ? m.role !== 'system' : true), opts).map((p) => {
      if (p.role === 'system') p.role = 'user'
      return p
    })
    return payload.map((message) => this.messageToContent(message))
  }

  private messageToContent(payload: LlmCompletionPayload): Content {

    if (payload.role === 'tool') {

      let response = payload.content
      try {
        response = JSON.parse(response)
      } catch {
        // ignore
      }

      return {
        role: 'tool',
        parts: [ {
          functionResponse: {
            id: payload.name,
            name: payload.name,
            response: response as any,
          }
        } ],
      }

    } else {

      const content: Content = {
        role: payload.role == 'assistant' ? 'model' : payload.role as 'user' | 'model',
        parts: Array.isArray(payload.content) ? payload.content.map((c) => ({
          text: (c as LLmContentPayloadText).text,
          // ...(c as LlmContentPayload).thoughtSignature ? { thoughtSignature: (c as LlmContentPayload).thoughtSignature } : {},
        })) : [ {
          text: payload.content as string,
        } ],
      }

      if (payload.role === 'assistant' && payload.tool_calls) {
        for (const tc of payload.tool_calls) {
          content.parts!.splice(content.parts!.length-1, 0, {
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
            ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {})
          })
        }
      }
      
      // add images
      for (const index in payload.images) {
        content.parts!.push({
          inlineData: {
            mimeType: 'image/png',
            data: payload.images[Number(index)],
          }
        })
      }
      
      // done
      return content

    }
  
  }

  private addAttachment(parts: Array<string|Part>, attachment: Attachment) {

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

  syncToolHistoryToThread(context: GoogleStreamingContext): void {
    // sync mutations from toolHistory back to content
    // Google content format: { role: 'tool', parts: [{ functionResponse: { id, name, response } }] }
    // Google doesn't manage IDs, so we match by name and index position
    let historyIndex = 0
    for (const msg of context.thread) {
      if (msg.role === 'tool' && msg.parts) {
        for (const part of msg.parts as Part[]) {
          const functionResponse = part.functionResponse as FunctionResponse | undefined
          if (functionResponse && historyIndex < context.toolHistory.length) {
            const entry = context.toolHistory[historyIndex]
            if (functionResponse.name === entry.name && functionResponse.response !== entry.result) {
              functionResponse.response = (typeof entry.result === 'string') ? { result: entry.result } : entry.result
            }
            historyIndex++
          }
        }
      }
    }
  }

  async *processNativeChunk(chunk: GenerateContentResponse, context: GoogleStreamingContext): AsyncGenerator<LlmChunk> {

    // debug
    //logger.log('[google] chunk', JSON.stringify(chunk))

    // usage
    if (chunk.usageMetadata) {
      context.requestUsage.prompt_tokens = chunk.usageMetadata.promptTokenCount ?? 0
      context.requestUsage.completion_tokens = chunk.usageMetadata.candidatesTokenCount ?? 0
      context.requestUsage.completion_tokens += chunk.usageMetadata.toolUsePromptTokenCount ?? 0
      context.requestUsage.completion_tokens_details!.reasoning_tokens! = chunk.usageMetadata.thoughtsTokenCount ?? 0
    }

    // tool calls - normalize and process (Google sends complete args, no deltas)
    const toolParts: Part[] = chunk.candidates?.[0].content?.parts?.filter(p => p.functionCall?.name) || []
    for (const part of toolParts) {
      const tc = part.functionCall!
      yield* this.processToolCallChunk({
        type: 'start',
        id: tc.id || crypto.randomUUID(),
        name: tc.name!,
        args: JSON.stringify(tc.args),
        metadata: {
          thoughtSignature: part.thoughtSignature,
        }
      }, context)
    }

    // check for finish reason and accumulated tool calls
    const done = !!chunk.candidates?.[0].finishReason
    if (done && context.toolCalls?.length) {

      // clear force tool call to avoid infinite loop
      if (context.opts.toolChoice?.type === 'tool') {
        delete context.opts.toolChoice
      }

      // increment round for next iteration
      context.currentRound++

      // add usage before continuing
      if (context.opts.usage) {
        context.usage = addUsages(context.usage, context.requestUsage)
        context.requestUsage = zeroUsage()
      }

      // execute tool calls using base class method
      yield* this.executeToolCallsBatched(context.toolCalls, context, {
        formatBatchForThread: (completed) => {
          // build assistant parts: text first (if present), then function calls
          const assistantParts: Part[] = []

          // add accumulated text content if present
          if (context.textContentBlock) {
            assistantParts.push({ text: context.textContentBlock })
          }

          // add function calls
          for (const { tc, args } of completed) {
            assistantParts.push({
              functionCall: {
                name: tc.function,
                args: args,
              },
              ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
            })
          }

          // assistant message with all content
          const assistantContent: Content = {
            role: 'assistant',
            parts: assistantParts,
          }

          // tool message with all function responses
          const toolContent: Content = {
            role: 'tool',
            parts: completed.map(({ tc, result }) => ({
              functionResponse: {
                id: tc.function,
                name: tc.function,
                response: result
              } as FunctionResponse
            })),
          }

          return [assistantContent, toolContent]
        },
        createNewStream: async () => this.doStream(context)
      })

      // done
      return

    }

    // iterate on candidates (content and reasoning)
    for (const candidate of chunk.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        const text = part.text || ''
        // accumulate text content (not thought/reasoning)
        if (!part.thought && text) {
          context.textContentBlock = (context.textContentBlock || '') + text
        }
        yield {
          type: part.thought ? 'reasoning' : 'content',
          text: text,
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          done: done
        }
      }
    }

    // usage
    if (done && context.opts.usage) {
      context.usage = addUsages(context.usage, context.requestUsage)
      yield { type: 'usage', usage: context.usage }
    }
  }
   
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(model: ChatModel, attachment: Attachment, payload: LlmCompletionPayloadContent, opts?: LlmCompletionOpts) {
    if (!payload.images) payload.images = []
    payload.images.push(attachment!.content)
  }

}
