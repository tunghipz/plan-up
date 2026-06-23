import { describe, expect, it } from 'vitest'
import {
  buildFileAttachmentPrompt,
  formatAiFileSize,
  isReadableTextFile,
  splitAiMessageDisplayContent,
  unreadableFileNames,
  type AiChatFileAttachment,
} from './ai/files'

describe('AI chat file attachments', () => {
  it('accepts text-like files and rejects binary files', () => {
    expect(isReadableTextFile({ name: 'notes.md', type: 'text/markdown' })).toBe(true)
    expect(isReadableTextFile({ name: 'data.json', type: 'application/json' })).toBe(true)
    expect(isReadableTextFile({ name: 'script.ts', type: '' })).toBe(true)
    expect(isReadableTextFile({ name: 'diagram.png', type: 'image/png' })).toBe(false)
    expect(unreadableFileNames([new File(['x'], 'diagram.png', { type: 'image/png' })])).toEqual([
      'diagram.png',
    ])
  })

  it('builds markdown prompt content for attached files', () => {
    const file: AiChatFileAttachment = {
      id: 'f1',
      name: 'tasks.csv',
      type: 'text/csv',
      size: 19,
      content: 'task,owner\nBuild,An',
      truncated: false,
    }

    expect(buildFileAttachmentPrompt([file])).toContain('### File 1: tasks.csv')
    expect(buildFileAttachmentPrompt([file])).toContain('task,owner\nBuild,An')
  })

  it('hides attached file content from chat display metadata', () => {
    const file: AiChatFileAttachment = {
      id: 'f1',
      name: 'tasks.csv',
      type: 'text/csv',
      size: 19,
      content: 'task,owner\nBuild,An',
      truncated: false,
    }
    const display = splitAiMessageDisplayContent(
      `Please review this.${buildFileAttachmentPrompt([file])}`
    )

    expect(display.body).toBe('Please review this.')
    expect(display.body).not.toContain('task,owner')
    expect(display.attachments).toEqual([{ name: 'tasks.csv', type: 'text/csv', size: 19 }])
  })

  it('formats attachment sizes for compact chips', () => {
    expect(formatAiFileSize(19)).toBe('19 B')
    expect(formatAiFileSize(1536)).toBe('1.5 KB')
    expect(formatAiFileSize(undefined)).toBe('')
  })
})
