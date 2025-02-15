
import { LlmRole, LlmChunkContent } from 'types/llm'
import Attachment from './attachment'

export default class Message {

  role: LlmRole
  content: string
  reasoning: string|null
  attachment: Attachment|null
  transient: boolean

  get contentForModel(): string {
    return this.content
  }

  constructor(role: LlmRole, content: string|null = null, attachment?: Attachment) {
    this.role = role
    this.reasoning = null
    this.content = (content !== null) ? content : ''
    this.attachment = attachment || null
    this.transient = (content == null)
  }

  attach(attachment: Attachment) {
    this.attachment = attachment
  }

  appendText(chunk: LlmChunkContent) {
    if (chunk?.text) {
      if (chunk?.type === 'reasoning') {
        this.reasoning = (this.reasoning || '') + chunk.text
      } else {
        this.content += chunk.text
      }
    }
    if (chunk?.done) {
      this.transient = false
    }
  }

}
