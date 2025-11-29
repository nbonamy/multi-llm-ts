
import { expect, test } from 'vitest'
import Message from '../../src/models/message'
import Attachment from '../../src/models/attachment'

test('message', async () => {

  expect(new Message('user')).toBeInstanceOf(Message)
  expect(new Message('user').role).toBe('user')
  expect(new Message('user').content).toBe('')

  const message = new Message('user')
  message.appendText({ type: 'content', text: 'text1', done: false })
  expect(message.content).toBe('text1')
  message.appendText({ type: 'content', text: '_text2', done: false })
  expect(message.content).toBe('text1_text2')
  message.appendText({ type: 'content', text: '_text3', done: true })
  expect(message.content).toBe('text1_text2_text3')

})

test('attachment', async () => {

  expect(new Attachment('sample content', 'text/plain').format()).toBe('txt')
  expect(new Attachment('sample content', 'text/x-py').format()).toBe('py')
  expect(new Attachment('sample content', 'application/pdf').format()).toBe('pdf')
  expect(new Attachment('sample content', 'application/x-yaml').format()).toBe('yaml')
  expect(new Attachment('sample content', 'application/javascript').format()).toBe('js')
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').format()).toBe('docx')
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.presentationml.presentation').format()).toBe('pptx')
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').format()).toBe('xlsx')
  expect(new Attachment('sample content', 'image/jpg').format()).toBe('jpg')
  expect(new Attachment('sample content', 'image/jpeg').format()).toBe('jpg')
  expect(new Attachment('sample content', 'image/png').format()).toBe('png')
  expect(new Attachment('sample content', 'image/webp').format()).toBe('webp')

  expect(new Attachment('sample content', 'text/plain').isText()).toBe(true)
  expect(new Attachment('sample content', 'text/x-py').isText()).toBe(true)
  expect(new Attachment('sample content', 'application/pdf').isText()).toBe(false)
  expect(new Attachment('sample content', 'application/x-yaml').isText()).toBe(true)
  expect(new Attachment('sample content', 'application/javascript').isText()).toBe(true)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').isText()).toBe(false)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.presentationml.presentation').isText()).toBe(false)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').isText()).toBe(false)
  expect(new Attachment('sample content', 'image/jpg').isText()).toBe(false)
  expect(new Attachment('sample content', 'image/jpeg').isText()).toBe(false)
  expect(new Attachment('sample content', 'image/png').isText()).toBe(false)
  expect(new Attachment('sample content', 'image/webp').isText()).toBe(false)

  expect(new Attachment('sample content', 'text/plain').isImage()).toBe(false)
  expect(new Attachment('sample content', 'text/x-py').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/pdf').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/x-yaml').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/javascript').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.presentationml.presentation').isImage()).toBe(false)
  expect(new Attachment('sample content', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').isImage()).toBe(false)
  expect(new Attachment('sample content', 'image/jpg').isImage()).toBe(true)
  expect(new Attachment('sample content', 'image/jpeg').isImage()).toBe(true)
  expect(new Attachment('sample content', 'image/png').isImage()).toBe(true)
  expect(new Attachment('sample content', 'image/webp').isImage()).toBe(true)

})
