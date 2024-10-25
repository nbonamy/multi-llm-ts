
import { Attachment } from 'types/index.d'

export const textFormats = [ 'pdf', 'txt', 'docx', 'pptx', 'xlsx' ]
export const imageFormats = [ 'jpeg', 'jpg', 'png', 'webp' ]


export function mimeTypeToExtension(mimeType: string): string {

  //console.log('mimeTypeToExtension', mimeType)
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

export default class implements Attachment {

  url: string
  mimeType: string
  contents: string
  downloaded: boolean

  constructor(url: string|object, mimeType = '', contents = '', downloaded = false) {

    if (url != null && typeof url === 'object') {
      this.fromJson(url)
      return
    }

    // default
    this.url = url as string
    this.mimeType = mimeType
    this.contents = contents
    this.downloaded = downloaded

  }

  fromJson(obj: any) {
    this.url = obj.url
    this.mimeType = obj.mimeType || extensionToMimeType(obj.format || '')
    this.contents = obj.contents
    this.downloaded = obj.downloaded
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
