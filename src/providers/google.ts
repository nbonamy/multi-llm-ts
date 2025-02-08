
import { EngineCreateOpts, Model } from 'types/index'
import { LLmCompletionPayload, LlmChunk, LlmCompletionOpts, LlmResponse, LlmStream, LlmToolCall } from 'types/llm'
import Attachment from '../models/attachment'
import Message from '../models/message'
import LlmEngine from '../engine'
import logger from '../logger'

import { Content, EnhancedGenerateContentResponse, GenerativeModel, GoogleGenerativeAI, ModelParams, Part, FunctionResponsePart, SchemaType, FunctionDeclarationSchemaProperty, FunctionCallingMode, GenerationConfig } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai/dist/types'

//
// https://ai.google.dev/gemini-api/docs
//

export default class extends LlmEngine {

  client: GoogleGenerativeAI
  currentModel: GenerativeModel|null = null
  currentContent: Content[] =[]
  currentOpts: LlmCompletionOpts|undefined = undefined
  toolCalls: LlmToolCall[] = []

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
  getVisionModels(): string[] {
    return [
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-*',
      'gemini-2.0-flash-*',
      'gemini-exp-1206',
      'gemini-2.0-flash-thinking-*',
    ]
  }

  async getModels(): Promise<Model[]> {

    // need an api key
    if (!this.client.apiKey) {
      return []
    }

    // https://ai.google.dev/api/models#models_get-SHELL
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.client.apiKey}`)
    const json = await response.json()

    // filter
    const models = []
    for (const model of json.models) {
      if (model.name.match(/\d\d\d$/)) continue
      if (model.name.includes('tuning')) continue
      if (model.description.includes('deprecated')) continue
      if (model.description.includes('discontinued')) continue
      if (model.supportedGenerationMethods.includes('generateContent')) {
        models.push({
          id: model.name.replace('models/', ''),
          name: model.displayName,
          meta: model
        })
      }
    }

    // reverse
    models.reverse()

    // now remove duplicated based on name
    const names: string[] = []
    const filtered = []
    for (const model of models) {
      if (names.includes(model.name)) continue
      names.push(model.name)
      filtered.push(model)
    }

    // done
    return filtered
    
  }

  async complete(modelName: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // call
    logger.log(`[google] prompting model ${modelName}`)
    const model = await this.getModel(modelName, thread[0].contentForModel)
    const response = await model.generateContent({
      contents: this.threadToHistory(thread, modelName, opts),
      generationConfig: this.getGenerationConfig(opts),
    })

    // done
    return {
      type: 'text',
      content: response.response.text(),
      ...(opts?.usage && response.response.usageMetadata ? { usage: {
        prompt_tokens: response.response.usageMetadata.promptTokenCount,
        completion_tokens: response.response.usageMetadata.candidatesTokenCount,
      } } : {}),
    }
  }

  async stream(modelName: string, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStream> {

    // model: switch to vision if needed
    modelName = this.selectModel(modelName, thread, opts)

    // call
    this.currentOpts = opts
    this.currentModel = await this.getModel(modelName, thread[0].contentForModel)
    this.currentContent = this.threadToHistory(thread, modelName, opts)
    return await this.doStream()

  }

  async doStream(): Promise<LlmStream> {

    // reset
    this.toolCalls = []

    logger.log(`[google] prompting model ${this.currentModel!.model}`)
    const response = await this.currentModel!.generateContentStream({
      contents: this.currentContent,
      generationConfig: this.getGenerationConfig(this.currentOpts),
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

  private supportsInstructions(model: string): boolean {
    return this.modelStartsWith(model, ['models/gemini-pro']) == false
  }

  private supportsTools(model: string): boolean {
    return model.includes('thinking') == false
  }

  async getModel(model: string, instructions: string): Promise<GenerativeModel> {

    // model params
    const modelParams: ModelParams = {
      model: model,
    }

    // add instructions
    if (this.supportsInstructions(model)) {
      modelParams.systemInstruction = instructions
    }

    // add tools
    if (this.supportsTools(model)) {

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
                  type: this.typeToSchemaType(props.items.type),
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

  private typeToSchemaType(type: string): SchemaType {
    if (type === 'string') return SchemaType.STRING
    if (type === 'number') return SchemaType.NUMBER
    if (type === 'boolean') return SchemaType.BOOLEAN
    if (type === 'array') return SchemaType.ARRAY
    return SchemaType.OBJECT
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

  threadToHistory(thread: Message[], modelName: string, opts?: LlmCompletionOpts): Content[] {
    const hasInstructions = this.supportsInstructions(modelName)
    const payload = this.buildPayload(modelName, thread.slice(hasInstructions ? 1 : 0), opts).map((p) => {
      if (p.role === 'system') p.role = 'user'
      return p
    })
    return payload.map((message) => this.messageToContent(message))
  }

  messageToContent(payload: LLmCompletionPayload): Content {
    const content: Content = {
      role: payload.role == 'assistant' ? 'model' : payload.role,
      parts: [ { text: payload.content as string } ]
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
  async stop(stream: AsyncGenerator<any>) {
    //await stream?.controller?.abort()
  }
   
  async *nativeChunkToLlmChunk(chunk: EnhancedGenerateContentResponse): AsyncGenerator<LlmChunk, void, void> {

    // debug
    // logger.log('[google] chunk', JSON.stringify(chunk))

    // tool calls
    const toolCalls = chunk.functionCalls()
    if (toolCalls?.length) {

      // save
      this.toolCalls = toolCalls.map((tc) => {
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
      for (const toolCall of this.toolCalls) {

        // first notify
        yield {
          type: 'tool',
          name: toolCall.function,
          status: this.getToolPreparationDescription(toolCall.function),
          done: false
        }

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
        logger.log(`[google] tool call ${toolCall.function} with ${JSON.stringify(args)} => ${JSON.stringify(content).substring(0, 128)}`)

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
      this.currentContent.push({
        role: 'assistant',
        parts: chunk.candidates![0].content.parts,
      })

      // send
      this.currentContent.push({
        role: 'tool',
        parts: results
      })

      // switch to new stream
      yield {
        type: 'stream',
        stream: await this.doStream(),
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
    if (done && this.currentOpts?.usage && chunk.usageMetadata) {
      yield { type: 'usage', usage: {
        prompt_tokens: chunk.usageMetadata.promptTokenCount,
        completion_tokens: chunk.usageMetadata.candidatesTokenCount,
      }}
    }
  }

   
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addImageToPayload(message: Message, payload: LLmCompletionPayload, opts?: LlmCompletionOpts) {
    payload.images = [ message.attachment!.content ]
  }

}
