import { describe, expect, it } from 'vitest'
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
})
