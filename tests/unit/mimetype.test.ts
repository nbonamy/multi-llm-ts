
import { expect, test } from 'vitest'
import { mimeTypeToExtension, extensionToMimeType } from '../../src/models/attachment'

test('MIME type to extension', async () => {
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx')
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
  expect(mimeTypeToExtension('text/plain')).toBe('txt')
  expect(mimeTypeToExtension('application/pdf')).toBe('pdf')
  expect(mimeTypeToExtension('image/png')).toBe('png')
  expect(mimeTypeToExtension('image/jpeg')).toBe('jpeg')
  expect(mimeTypeToExtension('image/gif')).toBe('gif')
  expect(mimeTypeToExtension('image/bmp')).toBe('bmp')
  expect(mimeTypeToExtension('image/tiff')).toBe('tiff')
  expect(mimeTypeToExtension('image/webp')).toBe('webp')
})

test('Extension to MIME type', async () => {
  expect(extensionToMimeType('docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  expect(extensionToMimeType('pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  expect(extensionToMimeType('xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  expect(extensionToMimeType('txt')).toBe('text/plain')
  expect(extensionToMimeType('pdf')).toBe('application/pdf')
  expect(extensionToMimeType('png')).toBe('image/png')
  expect(extensionToMimeType('jpg')).toBe('image/jpeg')
  expect(extensionToMimeType('jpeg')).toBe('image/jpeg')
  expect(extensionToMimeType('gif')).toBe('image/gif')
  expect(extensionToMimeType('webp')).toBe('image/webp')

  expect(extensionToMimeType('.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  expect(extensionToMimeType('.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  expect(extensionToMimeType('.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  expect(extensionToMimeType('.txt')).toBe('text/plain')
  expect(extensionToMimeType('.pdf')).toBe('application/pdf')
  expect(extensionToMimeType('.png')).toBe('image/png')
  expect(extensionToMimeType('.jpg')).toBe('image/jpeg')
  expect(extensionToMimeType('.jpeg')).toBe('image/jpeg')
  expect(extensionToMimeType('.gif')).toBe('image/gif')
  expect(extensionToMimeType('.webp')).toBe('image/webp')
})