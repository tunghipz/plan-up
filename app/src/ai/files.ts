export const AI_FILE_MAX_CHARS = 24_000
export const AI_FILE_MAX_COUNT = 4

export type AiChatFileAttachment = {
  id: string
  name: string
  type: string
  size: number
  content: string
  truncated: boolean
}

export type AiChatDisplayAttachment = {
  name: string
  type?: string
  size?: number
}

export type AiChatDisplayContent = {
  body: string
  attachments: AiChatDisplayAttachment[]
}

const ATTACHMENT_PROMPT_HEADER = 'Attached files for the assistant to read:'

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'sql',
  'log',
])

export function isReadableTextFile(file: Pick<File, 'name' | 'type'>) {
  if (file.type.startsWith('text/')) return true
  if (
    [
      'application/json',
      'application/xml',
      'application/x-yaml',
      'application/yaml',
      'text/csv',
    ].includes(file.type)
  ) {
    return true
  }
  const ext = file.name.split('.').pop()?.toLowerCase()
  return Boolean(ext && TEXT_EXTENSIONS.has(ext))
}

export async function readAiChatFiles(files: File[]): Promise<AiChatFileAttachment[]> {
  const readable = files.filter(isReadableTextFile).slice(0, AI_FILE_MAX_COUNT)
  return Promise.all(
    readable.map(async (file) => {
      const text = await file.text()
      const content = text.slice(0, AI_FILE_MAX_CHARS)
      return {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || 'text/plain',
        size: file.size,
        content,
        truncated: text.length > AI_FILE_MAX_CHARS,
      }
    })
  )
}

export function unreadableFileNames(files: File[]) {
  return files
    .filter((file) => !isReadableTextFile(file))
    .map((file) => file.name)
}

export function buildFileAttachmentPrompt(attachments: AiChatFileAttachment[]) {
  if (attachments.length === 0) return ''
  const parts = attachments.map((file, index) => {
    const fence = codeFenceFor(file.content)
    const truncated = file.truncated
      ? `\n[Content truncated to ${AI_FILE_MAX_CHARS.toLocaleString()} characters.]`
      : ''
    return `### File ${index + 1}: ${file.name}\nType: ${file.type}\nSize: ${file.size} bytes${truncated}\n\n${fence}\n${file.content}\n${fence}`
  })
  return `\n\nAttached files for the assistant to read:\n\n${parts.join('\n\n')}`
}

export function splitAiMessageDisplayContent(content: string): AiChatDisplayContent {
  const markerIndex = content.indexOf(ATTACHMENT_PROMPT_HEADER)
  if (markerIndex < 0) return { body: content, attachments: [] }

  const body = content.slice(0, markerIndex).trim()
  const attachmentPrompt = content.slice(markerIndex)
  return {
    body,
    attachments: parseAttachmentPromptMetadata(attachmentPrompt),
  }
}

export function formatAiFileSize(size: number | undefined) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function parseAttachmentPromptMetadata(prompt: string): AiChatDisplayAttachment[] {
  const matches = Array.from(prompt.matchAll(/^### File \d+: (.+)$/gm))
  return matches.map((match, index) => {
    const currentStart = match.index ?? 0
    const nextStart = matches[index + 1]?.index ?? prompt.length
    const section = prompt.slice(currentStart, nextStart)
    const type = section.match(/^Type:\s*(.+)$/m)?.[1]?.trim()
    const rawSize = section.match(/^Size:\s*(\d+)\s+bytes\b/m)?.[1]
    const size = rawSize ? Number(rawSize) : undefined
    return {
      name: match[1].trim(),
      type,
      size: Number.isFinite(size) ? size : undefined,
    }
  })
}

function codeFenceFor(content: string) {
  let ticks = '```'
  while (content.includes(ticks)) ticks += '`'
  return ticks
}
