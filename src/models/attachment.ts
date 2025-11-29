
const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const pptxMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const codeFormats = [
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'pyw', 'pyx', 'pyi',
  'java', 'kt', 'kts', 'groovy', 'scala',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'cs',
  'swift', 'm', 'mm',
  'rs', 'go', 'zig',
  'rb', 'php', 'pl', 'lua', 'r',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'psql', 'mysql',
  'gradle', 'maven', 'cmake', 'make', 'dockerfile',
]

export const configFormats = [
  'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env',
  'properties', 'conf', 'config', 'cfg',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc',
]

export const textFormats = [
  'txt', 'csv', 'md',
  'log', 'diff', 'patch',
  ...configFormats,
  ...codeFormats
]

export const imageFormats = [ 'jpeg', 'jpg', 'png', 'webp' ]

export default class Attachment {

  content: string
  mimeType: string
  title: string
  context: string

  constructor(content = '', mimeType = '') {
    this.content = content
    this.mimeType = mimeType
    this.title = ''
    this.context = ''
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

// MIME type to extension mapping
const mimeToExt: Record<string, string> = {
  // Office formats
  [docxMimeType]: 'docx',
  [pptxMimeType]: 'pptx',
  [xlsxMimeType]: 'xlsx',

  // Text formats
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',

  // Application formats
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/javascript': 'js',
  'application/xml': 'xml',
  'application/x-yaml': 'yaml',
  'application/octet-stream': 'bin',

  // Image formats
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
}

// Extension to MIME type mapping
const extToMime: Record<string, string> = {
  // Office formats
  'docx': docxMimeType,
  'pptx': pptxMimeType,
  'xlsx': xlsxMimeType,

  // Text formats
  'txt': 'text/plain',
  'md': 'text/markdown',
  'html': 'text/html',
  'htm': 'text/html',
  'css': 'text/css',
  'csv': 'text/csv',

  // Application formats
  'pdf': 'application/pdf',
  'json': 'application/json',
  'js': 'application/javascript',
  'xml': 'application/xml',
  'yaml': 'application/x-yaml',
  'yml': 'application/x-yaml',
  'exe': 'application/octet-stream',

  // Image formats
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'svg': 'image/svg+xml',
}

export function mimeTypeToExtension(mimeType: string): string {
  // Check direct mapping first
  if (mimeToExt[mimeType]) {
    return mimeToExt[mimeType]
  }

  // Handle text/x- and application/x- prefixes
  if (mimeType.startsWith('text/x-')) {
    return mimeType.slice(7)
  } else if (mimeType.startsWith('application/x-')) {
    return mimeType.slice(14)
  }

  // Fallback: extract from mime type (e.g., "image/png" -> "png")
  return mimeType.split('/')[1] || ''
}

export function extensionToMimeType(extension: string): string {
  
  // Remove leading dot if present
  if (extension.startsWith('.')) {
    extension = extension.slice(1)
  }

  const lower = extension.toLowerCase()

  // Check direct mapping
  if (extToMime[lower]) {
    return extToMime[lower]
  }

  // Fallback for text formats we recognize
  if (textFormats.includes(lower)) {
    return `text/x-${lower}`
  }

  return 'application/octet-stream'
}
