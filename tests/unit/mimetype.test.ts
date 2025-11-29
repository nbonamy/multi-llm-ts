
import { expect, test } from 'vitest'
import { mimeTypeToExtension, extensionToMimeType } from '../../src/models/attachment'

test('MIME type to extension', async () => {
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx')
  expect(mimeTypeToExtension('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
  expect(mimeTypeToExtension('text/plain')).toBe('txt')
  expect(mimeTypeToExtension('application/pdf')).toBe('pdf')
  expect(mimeTypeToExtension('application/javascript')).toBe('js')
  expect(mimeTypeToExtension('image/png')).toBe('png')
  expect(mimeTypeToExtension('image/jpeg')).toBe('jpg')
  expect(mimeTypeToExtension('image/gif')).toBe('gif')
  expect(mimeTypeToExtension('image/bmp')).toBe('bmp')
  expect(mimeTypeToExtension('image/tiff')).toBe('tif')
  expect(mimeTypeToExtension('image/webp')).toBe('webp')
})

test('Extension to MIME type', async () => {

  for (const prefix of ['', '.']) {
    expect(extensionToMimeType(`${prefix}docx`)).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(extensionToMimeType(`${prefix}pptx`)).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(extensionToMimeType(`${prefix}xlsx`)).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(extensionToMimeType(`${prefix}txt`)).toBe('text/plain')
    expect(extensionToMimeType(`${prefix}csv`)).toBe('text/csv')
    expect(extensionToMimeType(`${prefix}html`)).toBe('text/html')
    expect(extensionToMimeType(`${prefix}css`)).toBe('text/css')
    expect(extensionToMimeType(`${prefix}md`)).toBe('text/markdown')
    expect(extensionToMimeType(`${prefix}ts`)).toBe('text/x-ts')
    expect(extensionToMimeType(`${prefix}pdf`)).toBe('application/pdf')
    expect(extensionToMimeType(`${prefix}json`)).toBe('application/json')
    expect(extensionToMimeType(`${prefix}js`)).toBe('application/javascript')
    expect(extensionToMimeType(`${prefix}xml`)).toBe('application/xml')
    expect(extensionToMimeType(`${prefix}yml`)).toBe('application/x-yaml')
    expect(extensionToMimeType(`${prefix}yaml`)).toBe('application/x-yaml')
    expect(extensionToMimeType(`${prefix}png`)).toBe('image/png')
    expect(extensionToMimeType(`${prefix}jpg`)).toBe('image/jpeg')
    expect(extensionToMimeType(`${prefix}jpeg`)).toBe('image/jpeg')
    expect(extensionToMimeType(`${prefix}gif`)).toBe('image/gif')
    expect(extensionToMimeType(`${prefix}webp`)).toBe('image/webp')
    expect(extensionToMimeType(`${prefix}svg`)).toBe('image/svg+xml')
    expect(extensionToMimeType(`${prefix}exe`)).toBe('application/octet-stream')
  }
})
