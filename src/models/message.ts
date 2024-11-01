
import { LlmRole, LlmChunkContent } from 'types/llm.d'
import Attachment from './attachment'

export default class Message {

  role: LlmRole
  content: string
  attachment: Attachment
  transient: boolean

  constructor(role: LlmRole, content?: string, attachment: Attachment = null) {
    this.role = role
    this.content = content
    this.attachment = attachment
    this.transient = (content == null)
  }

  attach(attachment: Attachment) {
    this.attachment = attachment
  }

  appendText(chunk: LlmChunkContent) {
    if (chunk?.text) {
      this.content = (this.content||'') + chunk.text
    }
    if (chunk?.done) {
      this.transient = false
    }
  }

}
