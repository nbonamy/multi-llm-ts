
import { expect, test } from 'vitest'
import Message from '../../src/models/message'

test('message', async () => {

  expect(new Message('role')).toBeInstanceOf(Message)
  expect(new Message('role').role).toBe('role')
  expect(new Message('role').content).toBe('')

  const message = new Message('role')
  message.appendText({ text: 'text1' })
  expect(message.content).toBe('text1')
  expect(message.transient).toBe(true)
  message.appendText({ text: '_text2', done: false })
  expect(message.content).toBe('text1_text2')
  expect(message.transient).toBe(true)
  message.appendText({ text: '_text3', done: true })
  expect(message.content).toBe('text1_text2_text3')
  expect(message.transient).toBe(false)

})