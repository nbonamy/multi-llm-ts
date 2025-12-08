
import { LlmRole, LlmChunkContent, LlmToolCall } from '../types/llm'
import Attachment from './attachment'

export default class Message {

  role: LlmRole
  content: string
  reasoning: string|null
  attachments: Attachment[]
  toolCalls: LlmToolCall[]
  thoughtSignature?: string

  get contentForModel(): string {
    return this.content
  }

  constructor(role: LlmRole, content: string|null = null, attachment?: Attachment, toolCalls?: LlmToolCall[]) {
    this.role = role
    this.reasoning = null
    this.content = (content !== null) ? content : ''
    this.attachments = attachment ? [attachment] : []
    this.toolCalls = toolCalls || []
  }

  attach(attachment: Attachment) {
    this.attachments.push(attachment)
  }

  detach(attachment: Attachment) {
    const index = this.attachments.indexOf(attachment)
    if (index > -1) {
      this.attachments.splice(index, 1)
    }
  }

  appendText(chunk: LlmChunkContent) {
    if (chunk?.text) {
      if (chunk?.type === 'reasoning') {
        this.reasoning = (this.reasoning || '') + chunk.text
      } else {
        this.content += chunk.text
      }
    }
  }

}
