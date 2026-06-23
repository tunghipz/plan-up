import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from './ai/markdown'
import { parseMarkdownBlocks } from './ai/markdown-parser'

describe('AI chat markdown', () => {
  it('parses headings, lists, tables, and fenced code', () => {
    const blocks = parseMarkdownBlocks(`# Sprint summary

- Render bullet
- Render **bold** and \`inline code\`

| Task | Owner | Status |
| --- | --- | --- |
| Design | An | Done |
| Build | Binh | In progress |

\`\`\`ts
const ok = true
\`\`\``)

    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Sprint summary' })
    expect(blocks[1]).toMatchObject({
      type: 'ul',
      items: ['Render bullet', 'Render **bold** and `inline code`'],
    })
    expect(blocks[2]).toMatchObject({
      type: 'table',
      headers: ['Task', 'Owner', 'Status'],
      rows: [
        ['Design', 'An', 'Done'],
        ['Build', 'Binh', 'In progress'],
      ],
    })
    expect(blocks[3]).toMatchObject({
      type: 'code',
      language: 'ts',
      code: 'const ok = true',
    })
  })

  it('keeps file fence metadata for downloadable assistant files', () => {
    const blocks = parseMarkdownBlocks(`\`\`\`file:plan.csv
task,owner
Design,An
\`\`\``)

    expect(blocks[0]).toMatchObject({
      type: 'code',
      language: 'file:plan.csv',
      code: 'task,owner\nDesign,An',
    })
  })

  it('renders downloadable file blocks with a download action', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: `\`\`\`file:plan.csv
task,owner
Design,An
\`\`\``,
        inverted: false,
      })
    )

    expect(html).toContain('plan.csv')
    expect(html).toContain('Download')
    expect(html).toContain('task,owner')
  })
})
