
export const textFormats = [ 'pdf', 'txt', 'docx', 'pptx', 'xlsx' ]
export const imageFormats = [ 'jpeg', 'jpg', 'png', 'webp' ]

export default class Attachment {

  content: string
  mimeType: string

  constructor(content = '', mimeType = '') {
    this.content = content
    this.mimeType = mimeType
  }

  format(): string {
    return mimeTypeToExtension(this.mimeType)
  }

  isText(): boolean {
    return textFormats.includes(this.format())
  }

  isImage(): boolean {
    return imageFormats.includes(this.format())
  }

}

export function mimeTypeToExtension(mimeType: string): string {

  //logger.log('mimeTypeToExtension', mimeType)
  switch (mimeType) {
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx'
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx'
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx'
    case 'text/plain':
      return 'txt'
    default:
      // will support pdf (application/pdf)
      return mimeType.split('/')[1]
  }
}

export function extensionToMimeType(extension: string): string {
  if (extension.startsWith('.')) {
    extension = extension.slice(1)
  }
  switch (extension.toLowerCase()) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'txt':
      return 'text/plain'
    case 'pdf':
      return 'application/pdf'
    case 'jpg':
      return 'image/jpeg'
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
      return `image/${extension.toLowerCase()}`
    case 'svg':
      return 'image/svg+xml'
    case 'json':
      return 'application/json'
    case 'html':
      return 'text/html'
    case 'css':
      return 'text/css'
    case 'js':
      return 'application/javascript'
    case 'csv':
      return 'text/csv'
    default:
      return 'application/octet-stream'
  }
}