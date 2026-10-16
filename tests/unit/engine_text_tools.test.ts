import { expect, test, vi } from 'vitest'
import DeepSeek from '../../src/providers/deepseek'
import OpenAI from '../../src/providers/openai'
import Message from '../../src/models/message'
import { ToolExecutionDelegate } from '../../src/types/plugin'

const edit = { path: 'src/example.ts', edits: [{ oldText: 'const n = 1', newText: 'const n = 2\n// </tool_call> <｜tool▁call▁end｜> ``` is text' }] }
const cases = [
  {
    format: 'hermes' as const,
    engine: OpenAI,
    model: 'qwen3-32b',
    call: `<tool_call>\n${JSON.stringify({ name: 'edit_file', arguments: edit })}\n</tool_call>`,
  },
  {
    format: 'deepseek' as const,
    engine: DeepSeek,
    model: 'deepseek-reasoner',
    call: '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>edit_file\n```json\n' + JSON.stringify(edit) + '\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
  },
]

function editDelegate(execute = vi.fn().mockResolvedValue({ changed: true })): ToolExecutionDelegate {
  return {
    getTools: () => [{
      name: 'edit_file', description: 'Replace exact text in a file', parameters: [
        { name: 'path', type: 'string', description: 'File path', required: true },
        { name: 'edits', type: 'array', description: 'Replacements', required: true, items: {
          type: 'object', properties: [
            { name: 'oldText', type: 'string', description: 'Old text', required: true },
            { name: 'newText', type: 'string', description: 'New text', required: true },
          ],
        } },
      ],
    }], execute,
  }
}

for (const scenario of cases) {
  test(`${scenario.format} text tool calls execute complex edits and return results to the model`, async () => {
    const config = { apiKey: 'test', baseURL: 'https://example.test/v1', toolFormat: scenario.format }
    const engine = new scenario.engine(config)
    const execute = vi.fn().mockResolvedValue({ changed: true })
    const delegate = editDelegate(execute)
    const requests: any[] = []
    vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async (request: any) => {
      requests.push(structuredClone(request))
      return { choices: [{ message: { role: 'assistant', content: requests.length === 1 ? scenario.call : 'Edited.' }, finish_reason: 'stop' }] } as any
    })

    const result = await engine.complete(engine.buildModel(scenario.model), [new Message('user', 'Update n to 2')], { toolExecutionDelegate: delegate, toolChoice: { type: 'tool', name: 'edit_file' } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ model: scenario.model, abortSignal: undefined }, 'edit_file', edit)
    expect(result.content).toBe('Edited.')
    expect(result.toolCalls).toEqual([{ name: 'edit_file', params: edit, result: { changed: true } }])
    expect(requests).toHaveLength(2)
    expect(requests[0].tools).toBeUndefined()
    expect(requests[0].messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('edit_file') })
    expect(requests[0].messages[0].content).toContain('"oldText"')
    expect(requests[0].messages[0].content).toContain('You must call the tool edit_file.')
    expect(requests[1].messages[0].content).not.toContain('You must call the tool edit_file.')
    expect(engine.client.baseURL).toBe('https://example.test/v1')
    expect(JSON.stringify(requests[1].messages)).toContain('changed')
    expect(requests[1].messages.some((m: any) => m.role === 'tool' || m.tool_calls)).toBe(false)
  })
}

for (const scenario of cases) {
  test(`${scenario.format} streaming handles split markers, multiple calls, history and usage`, async () => {
    const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
    const delegate = editDelegate()
    const requests: any[] = []
    vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async (request: any) => {
      requests.push(structuredClone(request))
      const calls = (scenario.call + '\n' + scenario.call).replace('<｜tool▁calls▁end｜>\n<｜tool▁calls▁begin｜>', '\n')
      const content = requests.length === 1 ? 'Editing. ' + calls : 'Edited.'
      return {
        async *[Symbol.asyncIterator]() {
          for (const char of content) {
            yield { choices: [{ delta: { content: char }, finish_reason: null }] }
          }
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
          yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 20 } }
        },
      } as any
    })
    engine.addHook('beforeToolCallsResponse', async context => {
      for (const entry of context.toolHistory) entry.result = { changed: true, reviewed: true }
    })
    const chunks = []
    for await (const chunk of engine.generate(engine.buildModel(scenario.model), [new Message('user', 'Edit twice')], { toolExecutionDelegate: delegate, usage: true })) {
      chunks.push(chunk)
    }
    expect(delegate.execute).toHaveBeenCalledTimes(2)
    expect(chunks.filter(c => c.type === 'tool' && c.state === 'completed')).toHaveLength(2)
    expect(chunks.filter(c => c.type === 'content').map(c => c.text).join('')).toBe(scenario.format === 'hermes' ? 'Editing. \nEdited.' : 'Editing. Edited.')
    expect(chunks.filter(c => c.type === 'usage').at(-1)).toMatchObject({ usage: { prompt_tokens: 20, completion_tokens: 40 } })
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1].messages)).toContain('reviewed')
    expect(requests[1].messages.some((m: any) => m.role === 'tool' || m.tool_calls)).toBe(false)
    expect(requests[1].messages.filter((m: any) => m.role === 'assistant').every((m: any) => m.content.includes('Editing. '))).toBe(true)
  })

  test(`${scenario.format} rejects a truncated tool call without executing it`, async () => {
    const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
    const delegate = editDelegate()
    vi.spyOn(engine.client.chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: scenario.call.slice(0, -3) }, finish_reason: 'length' }],
    } as any)
    await expect(engine.complete(engine.buildModel(scenario.model), [new Message('user', 'Edit')], { toolExecutionDelegate: delegate })).rejects.toThrow('Incomplete text tool call')
    expect(delegate.execute).not.toHaveBeenCalled()
  })
}

test.each([
  { tools: false },
  { toolChoice: { type: 'none' as const } },
  { toolFormat: 'openai' as const },
])('text tool parsing respects request options %j', async opts => {
  const engine = new OpenAI({ apiKey: 'test', toolFormat: 'hermes' })
  const delegate = editDelegate()
  vi.spyOn(engine.client.chat.completions, 'create').mockResolvedValue({
    choices: [{ message: { role: 'assistant', content: cases[0].call }, finish_reason: 'stop' }],
  } as any)
  const result = await engine.complete(engine.buildModel('qwen3'), [new Message('user', 'Show example')], { ...opts, toolExecutionDelegate: delegate })
  expect(result.content).toBe(cases[0].call)
  expect(delegate.execute).not.toHaveBeenCalled()
})

test('Hermes calls in reasoning are not executed', async () => {
  const engine = new OpenAI({ apiKey: 'test', toolFormat: 'hermes' })
  const delegate = editDelegate()
  const content = `<think>For example: ${cases[0].call}</think>Done.`
  vi.spyOn(engine.client.chat.completions, 'create').mockResolvedValue({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  } as any)
  expect((await engine.complete(engine.buildModel('qwen3'), [new Message('user', 'Think')], { toolExecutionDelegate: delegate })).content).toBe(content)
  expect(delegate.execute).not.toHaveBeenCalled()
})

test.each(['complete', 'generate'] as const)('per-request Hermes format preserves history and validation in %s', async method => {
  const engine = new OpenAI({ apiKey: 'test', useOpenAIResponsesApi: true })
  const delegate = editDelegate()
  const validate = vi.fn().mockResolvedValue({ decision: 'deny' })
  const previous = new Message('assistant', 'Earlier edit.')
  previous.toolCalls = [{ id: 'previous', function: 'edit_file', args: edit, result: { previous: true } }]
  const requests: any[] = []
  vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async (request: any) => {
    requests.push(structuredClone(request))
    const content = requests.length === 1 ? cases[0].call : 'Denied.'
    if (request.stream) {
      return { async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content }, finish_reason: null }] }
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      } } as any
    }
    return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] } as any
  })
  const thread = [new Message('user', 'First edit'), previous, new Message('user', 'Another edit')]
  const opts = { toolFormat: 'hermes' as const, toolExecutionDelegate: delegate, toolExecutionValidation: validate }
  const model = engine.buildModel('qwen3')
  if (method === 'complete') {
    await expect(engine.complete(model, thread, opts)).rejects.toThrow('Tool execution was canceled')
  } else {
    const chunks = []
    for await (const chunk of engine.generate(model, thread, opts)) chunks.push(chunk)
    expect(chunks.filter(c => c.type === 'content').map(c => c.text).join('')).toBe('Denied.')
  }
  expect(validate).toHaveBeenCalledTimes(1)
  expect(delegate.execute).not.toHaveBeenCalled()
  expect(requests).toHaveLength(method === 'complete' ? 1 : 2)
  expect(requests[0].messages.find((m: any) => m.role === 'assistant').content).toContain('Earlier edit.')
  expect(JSON.stringify(requests[0].messages)).toContain('previous')
  if (method === 'generate') expect(JSON.stringify(requests[1].messages)).toContain('denied')
})

test.each(cases)('$format merges the tool prompt into the leading system message', async scenario => {
  const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
  const requests: any[] = []
  vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async (request: any) => {
    requests.push(structuredClone(request))
    return { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] } as any
  })
  await engine.complete(engine.buildModel(scenario.model), [new Message('system', 'You are X.'), new Message('user', 'Hi')], { toolExecutionDelegate: editDelegate() })
  const systems = requests[0].messages.filter((m: any) => m.role === 'system')
  expect(systems).toHaveLength(1)
  expect(requests[0].messages[0].content).toMatch(/^You are X\.\n\n.*edit_file/s)
})

test.each(cases)('$format executes a complete tool call even when finish_reason is length', async scenario => {
  const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
  const delegate = editDelegate()
  let calls = 0
  vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async () => {
    const content = calls++ === 0 ? scenario.call : 'Edited.'
    return { choices: [{ message: { role: 'assistant', content }, finish_reason: calls === 1 ? 'length' : 'stop' }] } as any
  })
  const result = await engine.complete(engine.buildModel(scenario.model), [new Message('user', 'Edit')], { toolExecutionDelegate: delegate })
  expect(delegate.execute).toHaveBeenCalledTimes(1)
  expect(result.content).toBe('Edited.')
})

test.each(cases)('$format streaming without finish_reason flushes text, executes complete calls and rejects unfinished calls', async scenario => {
  const run = async (content: string) => {
    const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
    const delegate = editDelegate()
    let requests = 0
    vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async () => {
      const first = requests++ === 0
      return { async *[Symbol.asyncIterator]() {
        for (const char of first ? content : 'Edited.') yield { choices: [{ delta: { content: char }, finish_reason: null }] }
        if (!first) yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      } } as any
    })
    const chunks: any[] = []
    try {
      for await (const chunk of engine.generate(engine.buildModel(scenario.model), [new Message('user', 'Edit')], { toolExecutionDelegate: delegate })) chunks.push(chunk)
    } catch (error) {
      return { chunks, delegate, error: error as Error }
    }
    return { chunks, delegate, error: undefined }
  }
  const flushed = await run('Hello <')
  expect(flushed.error).toBeUndefined()
  expect(flushed.chunks.filter(c => c.type === 'content').map(c => c.text).join('')).toBe('Hello <')
  const complete = await run(scenario.call)
  expect(complete.error).toBeUndefined()
  expect(complete.delegate.execute).toHaveBeenCalledTimes(1)
  expect(complete.chunks.filter(c => c.type === 'tool' && c.state === 'completed')).toHaveLength(1)
  expect(complete.chunks.filter(c => c.type === 'content').map(c => c.text).join('')).toBe('Edited.')
  const truncated = await run('Hi ' + scenario.call.slice(0, -3))
  expect(truncated.error?.message).toContain('Incomplete text tool call')
  expect(truncated.delegate.execute).not.toHaveBeenCalled()
})

for (const scenario of cases) {
  test.each(['complete', 'generate'] as const)(`${scenario.format} %s preserves quoted tool-call examples without executing them`, async method => {
    // Include native code fences inside arguments and the DeepSeek call syntax itself.
    const content = 'Examples:\n```xml\n' + scenario.call + '\n```\n~~~xml\n' + scenario.call + '\n~~~\nInline: ``' + scenario.call + '``'
    const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
    const delegate = editDelegate()
    let requests = 0
    let performEdit = false
    vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async (request: any) => {
      const reply = requests++ === 0 ? content + (performEdit ? '\n' + scenario.call : '') : 'Edited.'
      if (request.stream) return { async *[Symbol.asyncIterator]() {
        for (const char of reply) yield { choices: [{ delta: { content: char }, finish_reason: null }] }
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      } } as any
      return { choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] } as any
    })
    const run = async () => {
      let text = ''
      const thread = [new Message('user', performEdit ? 'Show examples, then edit' : 'Show tool-call examples')]
      if (method === 'complete') {
        text = (await engine.complete(engine.buildModel(scenario.model), thread, { toolExecutionDelegate: delegate })).content
      } else {
        for await (const chunk of engine.generate(engine.buildModel(scenario.model), thread, { toolExecutionDelegate: delegate })) {
          if (chunk.type === 'content') text += chunk.text
        }
      }
      return text
    }
    expect(await run()).toBe(content)
    expect(delegate.execute).not.toHaveBeenCalled()
    expect(requests).toBe(1)
    // Closing a code span/fence must re-enable real tool calls that follow it.
    requests = 0
    performEdit = true
    expect(await run()).toBe(method === 'complete' ? 'Edited.' : content + '\nEdited.')
    expect(delegate.execute).toHaveBeenCalledTimes(1)
    expect(requests).toBe(2)
  })

  test.each(['text-first', 'structured-first', 'same-chunk'])(`${scenario.format} streaming prefers structured calls for mirrored output (%s)`, async order => {
    const engine = new scenario.engine({ apiKey: 'test', toolFormat: scenario.format })
    const delegate = editDelegate()
    // Equal arguments can represent two intentional calls; retain both server IDs.
    const structured = ['server_a', 'server_b'].map((id, index) => ({ id, index, type: 'function', function: { name: 'edit_file', arguments: JSON.stringify(edit) } }))
    const text = { delta: { content: scenario.call + '\n' + scenario.call }, finish_reason: null }
    const native = { delta: { tool_calls: structured }, finish_reason: null }
    const choices = order === 'same-chunk'
      ? [{ delta: { ...text.delta, ...native.delta }, finish_reason: null }]
      : order === 'text-first' ? [text, native] : [native, text]
    let requests = 0
    vi.spyOn(engine.client.chat.completions, 'create').mockImplementation(async () => {
      const first = requests++ === 0
      return { async *[Symbol.asyncIterator]() {
        if (first) for (const choice of choices) yield { choices: [choice] }
        else yield { choices: [{ delta: { content: 'Edited.' }, finish_reason: null }] }
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      } } as any
    })
    const chunks = []
    for await (const chunk of engine.generate(engine.buildModel(scenario.model), [new Message('user', 'Edit twice')], { toolExecutionDelegate: delegate })) chunks.push(chunk)
    expect(delegate.execute).toHaveBeenCalledTimes(2)
    expect(chunks.filter(c => c.type === 'tool' && c.state === 'completed').map(c => c.id)).toEqual(['server_a', 'server_b'])
    expect(chunks.filter(c => c.type === 'tool' && c.state === 'preparing').map(c => c.id)).toEqual(['server_a', 'server_b'])
    expect(chunks.filter(c => c.type === 'content').map(c => c.text).join('')).toContain('Edited.')
    expect(requests).toBe(2)
  })
}
