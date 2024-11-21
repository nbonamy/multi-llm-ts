
import { LlmRole, LlmChunkContent } from 'types/llm.d'
import Attachment from './attachment'

export default class Message {

  role: LlmRole
  content: string
  attachment: Attachment|null
  transient: boolean

  get contentForModel(): string {
    return this.content
  }

  constructor(role: LlmRole, content: string|null = null, attachment?: Attachment) {
    this.role = role
    this.content = (content !== null) ? content : ''
    this.attachment = attachment || null
    this.transient = (content == null)
  }

  attach(attachment: Attachment) {
    this.attachment = attachment
  }

  appendText(chunk: LlmChunkContent) {
    if (chunk?.text) {
      this.content += chunk.text
    }
    if (chunk?.done) {
      this.transient = false
    }
  }

}
