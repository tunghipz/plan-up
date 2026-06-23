import { useMemo, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-parser'

export function MarkdownContent({
  content,
  inverted,
}: {
  content: string
  inverted: boolean
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content])
  if (blocks.length === 0) return null
  return (
    <div className={`space-y-2 ${inverted ? 'text-white' : 'text-ink'}`}>
      {blocks.map((block, index) => renderMarkdownBlock(block, index, inverted))}
    </div>
  )
}

function renderMarkdownBlock(block: MarkdownBlock, index: number, inverted: boolean) {
  if (block.type === 'heading') {
    const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
    return (
      <Tag key={index} className="font-semibold text-[1em] leading-snug">
        {renderInlineMarkdown(block.text, `h-${index}`)}
      </Tag>
    )
  }
  if (block.type === 'paragraph') {
    return (
      <p key={index} className="whitespace-pre-wrap">
        {renderInlineMarkdown(block.text, `p-${index}`)}
      </p>
    )
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const ListTag = block.type === 'ul' ? 'ul' : 'ol'
    return (
      <ListTag
        key={index}
        className={`space-y-1 pl-4 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'}`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInlineMarkdown(item, `li-${index}-${itemIndex}`)}</li>
        ))}
      </ListTag>
    )
  }
  if (block.type === 'code') {
    const fileName = downloadableFileName(block.language)
    if (fileName) {
      return (
        <div
          key={index}
          className={`max-w-full overflow-hidden rounded-[8px] ${
            inverted ? 'bg-white/12' : 'bg-black/[0.06]'
          }`}
        >
          <div
            className={`flex min-w-0 items-center gap-2 border-b px-3 py-1.5 text-[11.5px] ${
              inverted ? 'border-white/15 text-white' : 'border-border-hair text-ink-muted'
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium" title={fileName}>
              {fileName}
            </span>
            <button
              type="button"
              onClick={() => downloadTextFile(fileName, block.code)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[7px] px-2 py-1 font-medium transition ${
                inverted
                  ? 'bg-white/15 text-white hover:bg-white/20'
                  : 'bg-surface text-ink-muted hover:bg-surface-hover'
              }`}
              title={`Download ${fileName}`}
              aria-label={`Download ${fileName}`}
            >
              <Download size={12} />
              Download
            </button>
          </div>
          <pre className="max-w-full overflow-x-auto px-3 py-2 text-[12px] leading-relaxed">
            <code>{block.code}</code>
          </pre>
        </div>
      )
    }
    return (
      <pre
        key={index}
        className={`max-w-full overflow-x-auto rounded-[8px] px-3 py-2 text-[12px] leading-relaxed ${
          inverted ? 'bg-white/12' : 'bg-black/[0.06]'
        }`}
      >
        <code>{block.code}</code>
      </pre>
    )
  }
  if (block.type !== 'table') return null
  return (
    <div key={index} className="max-w-full overflow-x-auto">
      <table className="min-w-full border-collapse text-[12px] leading-snug">
        <thead>
          <tr>
            {block.headers.map((header, cellIndex) => (
              <th
                key={cellIndex}
                className="border border-border-hair bg-black/[0.04] px-2 py-1.5 text-left font-semibold"
              >
                {renderInlineMarkdown(header, `th-${index}-${cellIndex}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {block.headers.map((_, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border border-border-hair px-2 py-1.5 align-top"
                >
                  {renderInlineMarkdown(row[cellIndex] ?? '', `td-${index}-${rowIndex}-${cellIndex}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-${nodes.length}`
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-black/[0.08] px-1 py-0.5 text-[0.92em]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      nodes.push(
        link ? (
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            {link[1]}
          </a>
        ) : (
          token
        )
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function downloadableFileName(language?: string) {
  const info = language?.trim()
  if (!info) return null
  const match = info.match(/^(?:file|download):(.+)$/i) ?? info.match(/^filename=(.+)$/i)
  const rawName = match?.[1]?.trim().replace(/^["']|["']$/g, '')
  const baseName = rawName?.split(/[\\/]/).pop()?.trim()
  if (!baseName || baseName === '.' || baseName === '..') return null
  return baseName.replace(/[^\w .()[\]@+-]/g, '_').slice(0, 120)
}

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
