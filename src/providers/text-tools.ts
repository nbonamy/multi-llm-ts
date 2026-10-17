import { ChatCompletionMessageFunctionToolCall, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { LlmToolFormat } from '../types/index'
import { LlmToolOpenAI, LlmToolChoice } from '../types/llm'

type TextToolFormat = Exclude<LlmToolFormat, 'openai'>
type ParsedText = { text: string, calls: ChatCompletionMessageFunctionToolCall[] }

const deepseekStart = '<｜tool▁calls▁begin｜>'
const deepseekEnd = '<｜tool▁calls▁end｜>'
const deepseekCallStart = '<｜tool▁call▁begin｜>function<｜tool▁sep｜>'
const deepseekCallEnd = '<｜tool▁call▁end｜>'
let nextCallId = 0

function call(name: string, args: any): ChatCompletionMessageFunctionToolCall {
  if (typeof name !== 'string' || !name.trim() || args === undefined) {
    throw new Error('Invalid text tool call: expected a name and arguments')
  }
  const argumentsJson = typeof args === 'string' ? args : JSON.stringify(args)
  JSON.parse(argumentsJson)
  return { id: `text_tool_${Date.now()}_${nextCallId++}`, type: 'function', function: { name, arguments: argumentsJson } }
}

type JsonScan = {
  index: number
  depth: number
  quoted: boolean
  escaped: boolean
  parsed?: { end: number, value: any }
}

export function serializeTextToolCalls(calls: ChatCompletionMessageFunctionToolCall[], format: TextToolFormat): string {
  if (format === 'hermes') {
    return calls.map(tc => `<tool_call>\n${JSON.stringify({ name: tc.function.name, arguments: JSON.parse(tc.function.arguments) })}\n</tool_call>`).join('\n')
  }
  return deepseekStart + calls.map(tc => `${deepseekCallStart}${tc.function.name}\n\`\`\`json\n${tc.function.arguments}\n\`\`\`${deepseekCallEnd}`).join('\n') + deepseekEnd
}

export function textToolMessages(thread: ChatCompletionMessageParam[], format: TextToolFormat, tools: LlmToolOpenAI[], choice?: LlmToolChoice): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = []
  let prompt = ''
  if (tools.length) {
    const example = serializeTextToolCalls([{ id: '', type: 'function', function: { name: 'function_name', arguments: '{}' } }], format)
    prompt = [
      'You have access to the following tools. Use their JSON schemas to construct arguments.',
      '<tools>', ...tools.map(tool => JSON.stringify(tool)), '</tools>',
      `To call a tool, output this format, replacing the name and arguments:\n${example}`,
      'Tool calls must appear outside <think>...</think>. Do not wrap tool calls in Markdown code spans or fences. After calling tools, wait for their results before answering.',
      ...(choice?.type === 'required' ? ['You must call at least one tool.'] : []),
      ...(choice?.type === 'tool' ? [`You must call the tool ${choice.name}.`] : []),
    ].join('\n')
  }
  // Merge into the leading system message so templates that only honor the first one keep both.
  const first = thread[0]
  if (prompt && (first?.role === 'system' || first?.role === 'developer')) {
    const text = typeof first.content === 'string' ? first.content : first.content.map(part => part.text).join('\n')
    messages.push({ ...first, content: text ? `${text}\n\n${prompt}` : prompt })
    thread = thread.slice(1)
  } else if (prompt) {
    messages.push({ role: 'system', content: prompt })
  }
  for (const message of thread) {
    if (message.role === 'tool') {
      messages.push({ role: 'user', content: format === 'hermes'
        ? `<tool_response>\n${message.content}\n</tool_response>`
        : `<｜tool▁outputs▁begin｜><｜tool▁output▁begin｜>${message.content}<｜tool▁output▁end｜><｜tool▁outputs▁end｜>` })
    } else if (message.role === 'assistant' && message.tool_calls?.length) {
      const { tool_calls, ...rest } = message
      const text = typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n')
      messages.push({ ...rest, content: text + serializeTextToolCalls(tool_calls.filter(tc => tc.type === 'function'), format) })
    } else {
      messages.push(message)
    }
  }
  return messages
}

/** Incremental parser; only unfinished tool blocks (or marker prefixes) are buffered. */
export class TextToolParser {
  private buffer = ''
  private thinking = false
  private codeDelimiter = ''
  private fencedCode = false
  private lineIndent: number | undefined = 0
  private trailingBackslashes = 0
  private jsonScans = new Map<number, JsonScan>()
  private parsedCalls = new Map<number, ChatCompletionMessageFunctionToolCall>()

  constructor(private format: TextToolFormat) {}

  push(text: string, final = false): ParsedText {
    this.buffer += text
    const result: ParsedText = { text: '', calls: [] }
    const start = this.format === 'hermes' ? '<tool_call>' : deepseekStart
    while (this.buffer) {
      const markers = this.thinking ? ['</think>'] : this.codeDelimiter ? [this.codeDelimiter[0]] : [start, '<think>', '`', '~']
      const found = !this.thinking && !this.codeDelimiter && this.buffer.startsWith(start)
        ? { marker: start, index: 0 }
        : markers.map(marker => ({ marker, index: this.buffer.indexOf(marker) })).filter(entry => entry.index >= 0).sort((a, b) => a.index - b.index)[0]
      if (!found) {
        let keep = 0
        if (!final) {
          for (const marker of markers) {
            for (let n = 1; n < marker.length; n++) {
              if (this.buffer.endsWith(marker.slice(0, n))) keep = Math.max(keep, n)
            }
          }
        }
        this.appendText(result, this.buffer.slice(0, this.buffer.length - keep))
        this.buffer = this.buffer.slice(this.buffer.length - keep)
        break
      }
      this.appendText(result, this.buffer.slice(0, found.index))
      this.buffer = this.buffer.slice(found.index)
      if (found.marker === '`' || found.marker === '~') {
        let length = 0
        while (this.buffer[length] === found.marker) length++
        // A delimiter run can be split between chunks. Wait for its full length.
        if (length === this.buffer.length && !final) break
        const atLineStart = this.lineIndent !== undefined && this.lineIndent <= 3
        if (this.codeDelimiter) {
          if (this.fencedCode && atLineStart && length >= this.codeDelimiter.length) {
            const tail = this.buffer.slice(length)
            const newline = tail.search(/[\r\n]/)
            if (newline < 0 && !final) break
            // Fence closers may have only whitespace after them, unlike ```json.
            if (/^[ \t]*$/.test(newline < 0 ? tail : tail.slice(0, newline))) this.codeDelimiter = ''
          } else if (!this.fencedCode && length === this.codeDelimiter.length) {
            this.codeDelimiter = ''
          }
        } else if (this.trailingBackslashes % 2 === 0 && (found.marker === '`' || (atLineStart && length >= 3))) {
          this.codeDelimiter = this.buffer.slice(0, length)
          this.fencedCode = atLineStart && length >= 3
        }
        this.appendText(result, this.buffer.slice(0, length))
        this.buffer = this.buffer.slice(length)
        continue
      }
      if (found.marker !== start) {
        this.appendText(result, found.marker)
        this.buffer = this.buffer.slice(found.marker.length)
        this.thinking = found.marker === '<think>'
        continue
      }
      const parsed = this.parseBlock()
      if (!parsed) {
        if (final) throw new Error('Incomplete text tool call')
        break
      }
      result.calls.push(...parsed.calls)
      this.buffer = this.buffer.slice(parsed.end)
      this.jsonScans.clear()
      this.parsedCalls.clear()
      this.lineIndent = undefined
      this.trailingBackslashes = 0
    }
    return result
  }

  private appendText(result: ParsedText, text: string): void {
    result.text += text
    for (const char of text) {
      this.trailingBackslashes = char === '\\' ? this.trailingBackslashes + 1 : 0
      if (char === '\n' || char === '\r') this.lineIndent = 0
      else if (char === ' ' && this.lineIndent !== undefined) this.lineIndent++
      else this.lineIndent = undefined
    }
  }

  // Resume scanning at the previous offset instead of rescanning large edit arguments.
  // Delimiters and code fences inside JSON strings do not terminate a call.
  private readJson(start: number): { end: number, value: any } | undefined {
    if (this.buffer[start] !== '{') throw new Error('Invalid text tool call: expected a JSON object')
    const scan = this.jsonScans.get(start) || { index: start, depth: 0, quoted: false, escaped: false }
    this.jsonScans.set(start, scan)
    if (scan.parsed) return scan.parsed
    while (scan.index < this.buffer.length) {
      const char = this.buffer[scan.index++]
      if (scan.quoted) {
        if (scan.escaped) scan.escaped = false
        else if (char === '\\') scan.escaped = true
        else if (char === '"') scan.quoted = false
      } else if (char === '"') scan.quoted = true
      else if (char === '{' || char === '[') scan.depth++
      else if ((char === '}' || char === ']') && --scan.depth === 0) {
        scan.parsed = { end: scan.index, value: JSON.parse(this.buffer.slice(start, scan.index)) }
        return scan.parsed
      }
    }
  }

  private parseBlock(): { calls: ChatCompletionMessageFunctionToolCall[], end: number } | undefined {
    const text = this.buffer
    if (this.format === 'hermes') {
      const start = '<tool_call>'.length + (text.slice('<tool_call>'.length).match(/^\s*/)?.[0].length || 0)
      if (start === text.length) return
      const parsed = this.readJson(start)
      if (!parsed) return
      const { end, value } = parsed
      const suffix = text.slice(end).match(/^\s*<\/tool_call>/)
      if (!suffix) {
        if ('</tool_call>'.startsWith(text.slice(end).trimStart())) return
        throw new Error('Invalid text tool call: missing </tool_call>')
      }
      return { calls: [call(value.name, value.arguments)], end: end + suffix[0].length }
    }
    let pos = deepseekStart.length
    const calls: ChatCompletionMessageFunctionToolCall[] = []
    while (true) {
      pos += text.slice(pos).match(/^\s*/)?.[0].length || 0
      if (text.startsWith(deepseekEnd, pos)) {
        if (!calls.length) throw new Error('Invalid text tool call: empty call block')
        return { calls, end: pos + deepseekEnd.length }
      }
      if (deepseekEnd.startsWith(text.slice(pos)) || deepseekCallStart.startsWith(text.slice(pos))) return
      if (!text.startsWith(deepseekCallStart, pos)) throw new Error('Invalid DeepSeek tool call')
      pos += deepseekCallStart.length
      const header = text.slice(pos).match(/^([^\s]+)\s*```json\s*/)
      if (!header) return
      pos += header[0].length
      if (pos === text.length) return
      const parsed = this.readJson(pos)
      if (!parsed) return
      const { end, value } = parsed
      const suffix = text.slice(end).match(/^\s*```\s*<｜tool▁call▁end｜>/)
      if (!suffix) return
      if (!this.parsedCalls.has(pos)) this.parsedCalls.set(pos, call(header[1], value))
      calls.push(this.parsedCalls.get(pos)!)
      pos = end + suffix[0].length
    }
  }
}
