import { describe, it, expect } from 'vitest'
import ts from 'typescript'

// A `// comment` written between JSX children is not a comment: React renders it
// as visible text. That shipped once (v0.0.72: the vibrancy note showed up at the
// top of the desktop window). The linter has no rule for it here, so this test
// walks every .tsx and fails on a JSX text node that starts like a comment.
// Use `{/* … */}` inside JSX instead.

// Every .tsx next to this file, as raw text (Vite glob: no node fs types needed).
const SOURCES = import.meta.glob<string>('./*.tsx', { query: '?raw', import: 'default', eager: true })

function commentLikeJsxText(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []
  const walk = (n: ts.Node) => {
    if (n.kind === ts.SyntaxKind.JsxText) {
      const t = n.getText(sf)
      if (/(^|\n)\s*(\/\/|\/\*)/.test(t)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
        hits.push(`${file}:${line + 1}: ${t.trim().split('\n')[0]}`)
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return hits
}

describe('JSX', () => {
  it('has no // or /* comments written as JSX text (they render on screen)', () => {
    const files = Object.entries(SOURCES)
    expect(files.length).toBeGreaterThan(10)
    const hits = files.flatMap(([file, text]) => commentLikeJsxText(file, text))
    expect(hits).toEqual([])
  })
})
