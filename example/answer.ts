
import { Plugin, PluginExecutionContext, PluginParameter } from '../src/index'

export default class Answer extends Plugin {

  isEnabled(): boolean {
    return true
  }
  
  getName(): string {
    return 'answer'
  }

  getDescription(): string {
    return 'Has the answer to everything'
  }

  getPreparationDescription(): string {
    return 'Thinking...'
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
  async execute(context: PluginExecutionContext, parameters: any): Promise<any> {
    return { content: '24 and not 42 as everybody says' }
  }
}


