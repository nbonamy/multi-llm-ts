import Message from '../models/message'
import { ChatModel, EngineCreateOpts, ModelCapabilities, ModelLMStudio, ModelsList } from '../types/index'
import { LlmChunk, LlmCompletionOpts, LLmCompletionPayload, LlmResponse, LlmStream, LlmStreamingResponse, LlmToolCallInfo, LlmUsage } from '../types/llm'
import { Chat, ChatMessage, LLMPredictionConfigInput, LLMTool, LMStudioClient, Tool, ToolCallContext } from '@lmstudio/sdk'
import LlmEngine, { LlmStreamingContextTools } from '../engine'
import logger from '../logger'

export const lmStudioBaseURL = 'http://127.0.0.1:1234'

const kIsDone = 'MULTI_LLM_TS_LMSTUDIO_IS_DONE' 
const kToolCallRun = 'MULTI_LLM_TS_LMSTUDIO_TOOL_CALL_RUN'

export type LMStudioStreamingContext = LlmStreamingContextTools & {
  usage: LlmUsage
  thinking: boolean
}

export default class extends LlmEngine {

  client: LMStudioClient

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static isConfigured = (engineConfig: EngineCreateOpts): boolean => {
    return true
  }

  static isReady = (opts: EngineCreateOpts, models: ModelsList): boolean => {
    return models?.chat?.length > 0
  }

  constructor(config: EngineCreateOpts) {
    super(config)
    this.client = new LMStudioClient({
      baseUrl: config.baseURL,
    })
  }

  getId(): string {
    return 'lmstudio'
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  requiresFlatTextPayload(msg: Message): boolean {
    return true
  }

  getModelCapabilities(model: ModelLMStudio): ModelCapabilities {
    
    // Models that typically support reasoning
    const reasoningModels = [
      'qwq',
      'thinking',
      'reasoning',
      'cogito',
    ]

    return {
      tools: model.trainedForToolUse,
      vision: model.vision,
      reasoning: reasoningModels.some(m => model.id.includes(m)),
      caching: false,
    }
  }

  async getModels(): Promise<ModelLMStudio[]> {
    try {
      const response = await this.client.llm.model()
      return [{
        id: response.identifier,
        name: response.displayName,
        trainedForToolUse: response.trainedForToolUse,
        vision: response.vision,
      }]
    } catch (error) {
      console.error('Error listing models:', error);
      return [] 
    }
  }

  async chat(model: ChatModel, thread: any[], opts?: LlmCompletionOpts): Promise<LlmResponse> {

    // save tool calls
    const toolCallInfo: Record<string, LlmToolCallInfo> = {}

    // to save content
    let content = ''

    // llm studio does the multi-round thing on its own
    const onMessage = (message: ChatMessage) => {

      // only process assistant messages
      if (!message.isAssistantMessage()) {
        return
      }

      // first append text
      content += message.getText()

      // record tool calls requests
      for (const toolCall of message.getToolCallRequests()) {
        toolCallInfo[toolCall.id || toolCall.name] = {
          name: toolCall.name,
          params: toolCall.arguments,
          result: null,
        }
      }

      // update with results
      for (const toolCall of message.getToolCallResults()) {
        if (!toolCall.toolCallId) continue
        const info = toolCallInfo[toolCall.toolCallId]
        if (info) {
          info.result = toolCall.content
        }
      }
    }
    
    // call
    logger.log(`[lmstudio] prompting model ${model.id}`)
    const lmModel = await this.client.llm.model(model.id) 
    await lmModel.act(
      Chat.from(thread),
      await this.getToolOpts(model, opts || {}),
      {
        ...this.buildChatOptions({
          model: model.id,
          messages: thread,
          opts: opts || null,
        }),
        onMessage
      }
    )

    // return an object
    return {
      type: 'text',
      content: content,
      toolCalls: Object.values(toolCallInfo),
      // ...(opts?.usage ?  { usage: {
      //   prompt_tokens: response.stats.promptTokensCount ?? 0,
      //   completion_tokens: response.stats.predictedTokensCount ?? 0,
      // } } : {})
    }
  }

  async stream(model: ChatModel, thread: Message[], opts?: LlmCompletionOpts): Promise<LlmStreamingResponse> {

    // model: switch to vision if needed
    model = this.selectModel(model, thread, opts)

    // context
    const context: LMStudioStreamingContext = {
      model: model,
      thread: this.buildPayload(model, thread, opts),
      opts: opts || {},
      toolCalls: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
      thinking: false,
    }

    // do it
    return {
      stream: await this.doStream(context),
      context: context
    }
  }

  async doStream(context: LMStudioStreamingContext): Promise<LlmStream> {

    // reset
    context.toolCalls = []
    context.thinking = false

    // create a queue for messages
    const messageQueue: ChatMessage[] = []
    let isComplete = false
    let error: Error | null = null

    // abort controller for cancellation
    const abortController = new AbortController()

    // call
    logger.log(`[lmstudio] prompting model ${context.model.id}`)
    const lmModel = await this.client.llm.model(context.model.id) 
    lmModel.act(
      Chat.from(context.thread),
      await this.getToolOpts(context.model, context.opts || {}),
      {
        ...this.buildChatOptions({
          model: context.model.id,
          messages: context.thread,
          opts: context.opts
        }),
        onMessage: (message: ChatMessage) => {
          messageQueue.push(message)
        },
        onToolCallRequestNameReceived: (roundIndex: number, callId: number, name: string) => {
          messageQueue.push(ChatMessage.create('system', `${kToolCallRun}:${callId}:${name}`))
        },
        signal: abortController.signal
      }
    ).then(() => {
      isComplete = true
    }).catch((err: Error) => {
      error = err
      isComplete = true
    })

    // create async generator
    async function* generator(): AsyncGenerator<ChatMessage, void, void> {
      let messageIndex = 0
      
      while (!isComplete || messageIndex < messageQueue.length) {
        if (abortController.signal.aborted) {
          break
        }
        while (messageIndex < messageQueue.length) {
          yield messageQueue[messageIndex]
          messageIndex++
        }
        if (!isComplete) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }

      yield ChatMessage.create('system', kIsDone)
      
      if (error) {
        throw error
      }
    }

    // return the async iterable and controller
    const stream: LlmStream = generator() as LlmStream
    stream.controller = abortController
    return stream
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buildChatOptions({ model, messages, opts }: { model: string, messages: LLmCompletionPayload[], opts: LlmCompletionOpts|null }): LLMPredictionConfigInput {
    const chatOptions: LLMPredictionConfigInput = {}
    if (opts?.maxTokens) {
      chatOptions.maxTokens = opts.maxTokens
    }
    if (opts?.temperature) {
      chatOptions.temperature = opts.temperature
    }
    if (opts?.top_k) {
      chatOptions.topKSampling = opts.top_k
    }
    if (opts?.top_p) {
      chatOptions.topPSampling = opts.top_p
    }
    // if (opts?.structuredOutput) {
    //   chatOptions.structured = opts.structuredOutput.structure
    // }
    return chatOptions
  }

  async getToolOpts(model: ChatModel, opts?: LlmCompletionOpts): Promise<Tool[]> {

    // disabled?
    if (opts?.tools === false || !model.capabilities.tools) {
      return []
    }

    // tools
    const llmTools = await this.getAvailableTools()
    const lmsTools = llmTools.map((tool: LLMTool): Tool => ({
      type: 'rawFunction',
      name: tool.function.name,
      description: tool.function.description ?? '',
      parametersJsonSchema: tool.function.parameters,
      checkParameters() {},
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      implementation: async (params: Record<string, unknown>, ctx: ToolCallContext): Promise<any> => {
        return await this.callTool({ model: model.id }, tool.function.name, params)
      }
    }))

    // debug
    // console.log(lmsTools)

    // done
    return lmsTools
  
  }

  async stop(stream: LlmStream) {
    stream.controller?.abort()
  }
  
  async *nativeChunkToLlmChunk(chunk: ChatMessage, context: LMStudioStreamingContext): AsyncGenerator<LlmChunk, void, void> {
    
    // debug
    console.dir(chunk, { depth: null })

    // is done?
    if (chunk.getRole() === 'system' && chunk.getText() === kIsDone) {
      yield {
        type: 'content',
        text: '',
        done: true,
      }
      return
    }

    // our own hack for tool prep
    if (chunk.getRole() === 'system' && chunk.getText().startsWith(kToolCallRun)) {
      
      const parts = chunk.getText().split(':')
      if (parts.length < 3) return
      const callId = parts[1]
      let name = parts[2]

      // if we have more than 3 parts, it means the tool name has a colon in it
      if (parts.length > 3) {
        name = parts.slice(2).join(':')
      }
      
      yield {
        type: 'tool',
        id: callId,
        name: name,
        status: this.getToolPreparationDescription(name),
        done: false,
      }

    }

    // process only assistant messages
    if (!['assistant', 'tool'].includes(chunk.getRole())) {
      return
    }

    // check if we have text
    const text = chunk.getText()
    if (text.length) {
      yield {
        type: 'content',
        text: text,
        done: false,
      }
    }

    // now tool call requests
    for (const toolCall of chunk.getToolCallRequests()) {

      if (typeof toolCall.id === 'undefined') continue

      context.toolCalls.push({
        id: toolCall.id,
        message: toolCall,
        function: toolCall.name,
        args: JSON.stringify(toolCall.arguments),
      })

      yield {
        type: 'tool',
        id: toolCall.id,
        name: toolCall.name,
        status: this.getToolRunningDescription(toolCall.name, toolCall.arguments),
        call: {
          params: toolCall.arguments,
          result: undefined
        },
        done: false,
      }

    }

    // now tool call results
    for (const toolCall of chunk.getToolCallResults()) {

      if (typeof toolCall.toolCallId === 'undefined') continue
      const info = context.toolCalls.find(tc => tc.id === toolCall.toolCallId)
      if (!info) continue

      let result = toolCall.content
      try {
        result = JSON.parse(toolCall.content)
      } catch { /* empty */ }

      yield {
        type: 'tool',
        id: toolCall.toolCallId ?? '',
        name: info.function,
        status: this.getToolCompletedDescription(info.function, info.args, result),
        done: true,
        call: {
          params: JSON.parse(info.args),
          result: result,
        }
      }

    }

  }
}
