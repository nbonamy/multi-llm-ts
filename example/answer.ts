
import { type anyDict, Plugin, type PluginParameter } from '../src/index'

export default class Answer extends Plugin {

  isEnabled(): boolean {
    return true
  }
  
  getName(): string {
    return 'Answer'
  }

  getDescription(): string {
    return 'Has the answer to everything'
  }

  getRunningDescription(): string {
    return 'Answering the question'
  }

  getParameters(): PluginParameter[] {
    return [
      { name: 'question', type: 'string', description: 'The question to answer', required: true },
    ]
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(parameters: anyDict): Promise<anyDict> {
    return { content: '42' }
  }
}


