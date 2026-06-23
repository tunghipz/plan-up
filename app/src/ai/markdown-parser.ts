export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'code'; language?: string; code: string }
  | { type: 'table'; headers: string[]; rows: string[][] }

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      continue
    }

    const codeStart = trimmed.match(/^(`{3,})([^\s`]*)\s*$/)
    if (codeStart) {
      flushParagraph()
      const fence = codeStart[1]
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        code.push(lines[i])
        i += 1
      }
      blocks.push({ type: 'code', language: codeStart[2], code: code.join('\n') })
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      })
      continue
    }

    if (isMarkdownTableStart(lines, i)) {
      flushParagraph()
      const headers = splitTableRow(lines[i])
      i += 2
      const rows: string[][] = []
      while (i < lines.length && splitTableRow(lines[i]).length > 1) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      i -= 1
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      flushParagraph()
      const items = [unordered[1].trim()]
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^[-*]\s+(.+)$/)
        if (!next) break
        items.push(next[1].trim())
        i += 1
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ordered) {
      flushParagraph()
      const items = [ordered[1].trim()]
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim().match(/^\d+[.)]\s+(.+)$/)
        if (!next) break
        items.push(next[1].trim())
        i += 1
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    paragraph.push(trimmed)
  }
  flushParagraph()
  return blocks
}

function isMarkdownTableStart(lines: string[], index: number) {
  if (index + 1 >= lines.length) return false
  const header = splitTableRow(lines[index])
  const separator = splitTableRow(lines[index + 1])
  return (
    header.length > 1 &&
    separator.length === header.length &&
    separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  )
}

function splitTableRow(line: string) {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return []
  const withoutOuter = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutOuter.split('|').map((cell) => cell.trim())
}
