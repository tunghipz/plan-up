/**
 * Inline "markdown-lite" formatting for task / item titles.
 *
 * A title stays a plain `string` in IndexedDB — formatting lives as markers in
 * the text itself (`**bold**`, `*italic*`, `~~strike~~`, `==highlight==`). That
 * keeps backups human-readable, needs no Dexie bump, and lets every plain-text
 * sink (Telegram export, `title=` tooltips, search) fall back with one
 * `stripRich()` call. See design-docs/task-rich-text.md.
 */

export type Mark = 'bold' | 'italic' | 'strike' | 'mark'

export interface RichSeg {
  text: string
  marks: Mark[]
  /** Index in the SOURCE string where this segment's text starts. Lets a click
   * on the rendered title map back to a caret offset in the raw markers. */
  from: number
}

/**
 * Delimiters, longest first — `***` before `**` before `*`, or `***x***` would
 * parse as bold-then-stray-star instead of bold + italic.
 */
const DELIMS: { d: string; marks: Mark[] }[] = [
  { d: '***', marks: ['bold', 'italic'] },
  { d: '**', marks: ['bold'] },
  { d: '~~', marks: ['strike'] },
  { d: '==', marks: ['mark'] },
  { d: '*', marks: ['italic'] },
]

export const MARK_DELIM: Record<Mark, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  mark: '==',
}

function pushSeg(out: RichSeg[], text: string, marks: Mark[], from: number) {
  if (!text) return
  const last = out[out.length - 1]
  // Merge with the previous segment when the mark set is identical AND the two
  // are adjacent in the source — keeps the rendered DOM (and the PNG export)
  // free of pointless adjacent spans without breaking the source mapping.
  if (
    last &&
    last.from + last.text.length === from &&
    last.marks.length === marks.length &&
    last.marks.every((m, i) => marks[i] === m)
  ) {
    last.text += text
    return
  }
  out.push({ text, marks, from })
}

function withMarks(marks: Mark[], add: Mark[]): Mark[] {
  const out = [...marks]
  for (const m of add) if (!out.includes(m)) out.push(m)
  return out
}

/** Index of the next unescaped `d` at or after `from`, stopping at a newline. */
function findCloser(src: string, from: number, d: string): number {
  for (let i = from; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\n') return -1
    if (ch === '\\') {
      i++ // skip the escaped char — it can never close a span
      continue
    }
    if (src.startsWith(d, i)) return i
  }
  return -1
}

/**
 * Parse `src` into styled segments. Single left-to-right scan: a delimiter only
 * opens a span when its closer exists later **on the same line**; otherwise it
 * is literal text, so `2 * 3 * 4` and `a**b` survive as typed. `\*` escapes.
 */
export function parseRich(src: string, marks: Mark[] = [], base = 0): RichSeg[] {
  const out: RichSeg[] = []
  let plain = ''
  let plainFrom = 0
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length && '*~=\\'.includes(src[i + 1])) {
      if (!plain) plainFrom = i + 1
      plain += src[i + 1]
      i += 2
      continue
    }
    const hit = DELIMS.find((x) => src.startsWith(x.d, i))
    if (hit) {
      // Closer must be at least 1 char away, before the next newline, and not
      // itself escaped — `*a \* b*` italicises the whole run, the inner star stays.
      const from = i + hit.d.length
      const close = findCloser(src, from + 1, hit.d)
      if (close !== -1) {
        pushSeg(out, plain, marks, base + plainFrom)
        plain = ''
        for (const seg of parseRich(
          src.slice(from, close),
          withMarks(marks, hit.marks),
          base + from
        )) {
          pushSeg(out, seg.text, seg.marks, seg.from)
        }
        i = close + hit.d.length
        continue
      }
    }
    if (!plain) plainFrom = i
    plain += ch
    i++
  }
  pushSeg(out, plain, marks, base + plainFrom)
  return out
}

/**
 * Map an offset in the RENDERED (marker-free) text back to an offset in the raw
 * source, so clicking a formatted title drops the caret on the character the
 * user actually pointed at once the markers reappear.
 */
export function sourceIndexFor(src: string, renderedIdx: number): number {
  let seen = 0
  for (const seg of parseRich(src)) {
    // `<`, not `<=`: an offset that lands exactly on a segment boundary belongs
    // to the NEXT segment, or the caret would sit on the closing marker of the
    // previous one (clicking just before a bold word put it between the stars).
    if (renderedIdx < seen + seg.text.length) return seg.from + (renderedIdx - seen)
    seen += seg.text.length
  }
  return src.length
}

/** The title as the user reads it — markers removed. Use for every plain-text sink. */
export function stripRich(src: string): string {
  if (!src) return src
  return parseRich(src)
    .map((s) => s.text)
    .join('')
}

/** True when the title carries no visible text (markers only / whitespace). */
export function isBlankRich(src: string): boolean {
  return !stripRich(src ?? '').trim()
}

export interface ToggleResult {
  value: string
  start: number
  end: number
}

/** Length of the run of `*` immediately before (dir -1) or after (dir 1) `pos`. */
function starRun(value: string, pos: number, dir: -1 | 1): number {
  let n = 0
  let i = dir === -1 ? pos - 1 : pos
  while (i >= 0 && i < value.length && value[i] === '*') {
    n++
    i += dir
  }
  return n
}

/**
 * Wrap (or unwrap) `value[start..end]` in `mark`'s delimiter. Returns the new
 * string plus the selection to restore — always around the *inner* text, so
 * ⌘B then ⌘I nests into `***text***` instead of losing the selection.
 *
 * With an empty selection it inserts the empty pair and parks the caret inside.
 */
export function toggleMark(value: string, start: number, end: number, mark: Mark): ToggleResult {
  const d = MARK_DELIM[mark]
  const n = d.length
  const sel = value.slice(start, end)

  // Markers *inside* the selection (the user dragged across them): `[**text**]`.
  if (sel.length >= 2 * n && sel.startsWith(d) && sel.endsWith(d)) {
    const inner = sel.slice(n, sel.length - n)
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    }
  }

  // Markers *outside* the selection: `**[text]**`. For the two star marks the
  // run has to be read as a whole — `*` and `**` share a prefix, so a naive
  // prefix test would strip one star off a bold pair and leave `*text*` behind.
  // Run of 1 = italic, 2 = bold, 3+ = both; unwrap only the mark that is there.
  let wrapped: boolean
  if (mark === 'bold' || mark === 'italic') {
    const run = Math.min(starRun(value, start, -1), starRun(value, end, 1))
    wrapped = mark === 'bold' ? run >= 2 : run === 1 || run >= 3
  } else {
    wrapped = value.slice(start - n, start) === d && value.slice(end, end + n) === d
  }
  if (wrapped) {
    return {
      value: value.slice(0, start - n) + sel + value.slice(end + n),
      start: start - n,
      end: end - n,
    }
  }
  return {
    value: value.slice(0, start) + d + sel + d + value.slice(end),
    start: start + n,
    end: start + n + sel.length,
  }
}

/**
 * Map a keyboard event to a mark. ⌘B / ⌘I, plus ⌘⇧X (strike) and ⌘⇧H
 * (highlight) — the two that browsers leave free. Returns null for anything else.
 */
export function markForKey(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}): Mark | null {
  if (!e.metaKey && !e.ctrlKey) return null
  const k = e.key.toLowerCase()
  if (e.shiftKey) {
    if (k === 'x') return 'strike'
    if (k === 'h') return 'mark'
    return null
  }
  if (k === 'b') return 'bold'
  if (k === 'i') return 'italic'
  return null
}

/**
 * Character offset inside `root` for a viewport point — the browser APIs for
 * this are split (standard `caretPositionFromPoint` vs WebKit's
 * `caretRangeFromPoint`), and both are absent in older Safari. Returns null when
 * the caret can't be resolved; the caller then falls back to end-of-text.
 */
export function caretOffsetFromPoint(x: number, y: number, root: HTMLElement | null): number | null {
  if (!root) return null
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  let node: Node | null
  let offset: number
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (pos) {
    node = pos.offsetNode
    offset = pos.offset
  } else {
    const range = doc.caretRangeFromPoint?.(x, y)
    if (!range) return null
    node = range.startContainer
    offset = range.startOffset
  }
  if (!node || !root.contains(node)) return null
  // Sum the text length of every node before the hit node — the rendered title
  // is several <span>s, so the offset is per-node, not per-field.
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === node) return total + offset
    total += n.textContent?.length ?? 0
  }
  return null
}
