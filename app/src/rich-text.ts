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

/** Nesting order when a run carries several marks — outermost first. */
const ORDER: Mark[] = ['bold', 'italic', 'strike', 'mark']

function sortMarks(marks: Mark[]): Mark[] {
  return ORDER.filter((m) => marks.includes(m))
}

/** Escape the characters that could be read back as a delimiter. */
function escapeText(text: string): string {
  return text.replace(/[*~=]/g, (c) => '\\' + c)
}

/**
 * Render segments back to a marker string. Marks nest in `ORDER`, so a run that
 * is bold + highlighted always serialises as `**==x==**` — one canonical form,
 * which is what keeps repeated toggles from growing stray markers.
 */
function serializeRich(segs: RichSeg[], escape: boolean): string {
  let out = ''
  let open: Mark[] = []
  for (const seg of segs) {
    if (!seg.text) continue
    const want = sortMarks(seg.marks)
    // Close from the inside out until what stays open is a prefix of `want`.
    let keep = 0
    while (keep < open.length && keep < want.length && open[keep] === want[keep]) keep++
    for (let i = open.length - 1; i >= keep; i--) out += MARK_DELIM[open[i]]
    for (let i = keep; i < want.length; i++) out += MARK_DELIM[want[i]]
    open = want
    out += escape ? escapeText(seg.text) : seg.text
  }
  for (let i = open.length - 1; i >= 0; i--) out += MARK_DELIM[open[i]]
  return out
}

/** Do two segment lists render identically (same text, same marks)? */
function sameShape(a: RichSeg[], b: RichSeg[]): boolean {
  const norm = (segs: RichSeg[]) =>
    segs
      .filter((s) => s.text)
      .map((s) => s.text + '\u0000' + sortMarks(s.marks).join(','))
      .join('\u0001')
  return norm(a) === norm(b)
}

/**
 * Add or remove `mark` over `[start, end)` (SOURCE offsets) and re-serialise the
 * whole title canonically.
 *
 * Splicing delimiters in place looked simpler but cannot survive the cases the
 * bubble toolbar produces every day — a selection that crosses a mark boundary,
 * or a mark nested two deep — where a local splice leaves stray `**` that then
 * read as literal text. Rebuilding from the parse tree makes those impossible:
 * the VISIBLE text is invariant by construction.
 */
export function setMark(
  src: string,
  start: number,
  end: number,
  mark: Mark,
  on: boolean
): ToggleResult {
  const next: RichSeg[] = []
  for (const seg of parseRich(src)) {
    const a = seg.from
    const b = seg.from + seg.text.length
    // Split the segment at the selection bounds, then re-mark only the middle.
    const cuts = [a, Math.min(Math.max(start, a), b), Math.min(Math.max(end, a), b), b]
    for (let i = 0; i < 3; i++) {
      const from = cuts[i]
      const to = cuts[i + 1]
      if (to <= from) continue
      const inside = i === 1
      const marks = inside
        ? on
          ? sortMarks([...seg.marks, mark])
          : seg.marks.filter((m) => m !== mark)
        : seg.marks
      next.push({ text: src.slice(from, to), marks, from })
    }
  }
  // The visible text never changes, so the selection is mapped through RENDERED
  // offsets — they are the one thing both strings agree on.
  const renderedStart = renderedIndexFor(src, start)
  const renderedEnd = renderedIndexFor(src, end)
  let value = serializeRich(next, false)
  // Literal `*` / `~~` / `==` already in the text could pair up with the markers
  // we just emitted; if the result doesn't parse back to the same thing, escape.
  if (!sameShape(parseRich(value), next)) value = serializeRich(next, true)
  return {
    value,
    start: sourceIndexFor(value, renderedStart),
    end: renderedEnd > renderedStart ? sourceIndexFor(value, renderedEnd - 1) + 1 : sourceIndexFor(value, renderedEnd),
  }
}

/**
 * Wrap (or unwrap) `value[start..end]` in `mark`. Returns the new string plus
 * the selection to restore — always around the *inner* text, so ⌘B then ⌘I
 * nests into `***text***` instead of losing the selection.
 *
 * With an empty selection it inserts the empty pair and parks the caret inside.
 */
export function toggleMark(value: string, start: number, end: number, mark: Mark): ToggleResult {
  if (start === end) {
    const d = MARK_DELIM[mark]
    return {
      value: value.slice(0, start) + d + d + value.slice(end),
      start: start + d.length,
      end: start + d.length,
    }
  }
  return setMark(value, start, end, mark, !marksAt(value, start, end).includes(mark))
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

/**
 * Marks that cover the WHOLE of `[start, end)` in the source — what the bubble
 * toolbar shows as "active" (and therefore what a click will REMOVE).
 */
export function marksAt(src: string, start: number, end: number): Mark[] {
  if (end <= start) return []
  let common: Mark[] | null = null
  for (const seg of parseRich(src)) {
    const a = seg.from
    const b = seg.from + seg.text.length
    if (b <= start || a >= end) continue // no overlap
    common = common === null ? seg.marks : common.filter((m) => seg.marks.includes(m))
    if (!common.length) return []
  }
  return common ?? []
}

/**
 * Turn a DOM selection inside a rendered title into source offsets. Walks the
 * same text nodes `caretOffsetFromPoint` does, so both agree on what "rendered
 * offset N" means, then maps through `sourceIndexFor`.
 *
 * Returns null when either end of the range falls outside `root` — e.g. the user
 * dragged across several rows.
 */
export function rangeToSource(
  src: string,
  root: HTMLElement,
  range: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }
): [number, number] | null {
  const offsetOf = (node: Node, offset: number): number | null => {
    if (!root.contains(node)) return null
    // A range end can land on an ELEMENT (offset = child index) rather than a
    // text node — normalise by summing the text before that child.
    if (node.nodeType !== Node.TEXT_NODE) {
      let seen = 0
      for (let i = 0; i < offset && i < node.childNodes.length; i++) {
        seen += node.childNodes[i].textContent?.length ?? 0
      }
      return textBefore(root, node) + seen
    }
    return textBefore(root, node) + offset
  }
  const a = offsetOf(range.startContainer, range.startOffset)
  const b = offsetOf(range.endContainer, range.endOffset)
  if (a === null || b === null) return null
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  if (lo === hi) return null
  // `sourceIndexFor` maps a caret; the END of a selection wants the position
  // just AFTER the last selected character, so map hi-1 and step past it.
  return [sourceIndexFor(src, lo), sourceIndexFor(src, hi - 1) + 1]
}

/** Total length of the text nodes preceding `node` inside `root`. */
function textBefore(root: HTMLElement, node: Node): number {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === node) return total
    if (node.contains(n)) return total // element node: stop at its first text child
    total += n.textContent?.length ?? 0
  }
  return total
}

/**
 * Inverse of `sourceIndexFor`: where a raw offset lands in the rendered text.
 * Used to restore a selection after a mark toggle rewrites the markers around it.
 */
export function renderedIndexFor(src: string, sourceIdx: number): number {
  let seen = 0
  for (const seg of parseRich(src)) {
    if (sourceIdx < seg.from) return seen // inside a marker — snap to the text after it
    if (sourceIdx < seg.from + seg.text.length) return seen + (sourceIdx - seg.from)
    seen += seg.text.length
  }
  return seen
}

/** The text node (and offset into it) holding rendered offset `idx` inside `root`. */
function nodeAt(root: HTMLElement, idx: number): { node: Node; offset: number } | null {
  let seen = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n: Node | null
  let last: { node: Node; offset: number } | null = null
  while ((n = walker.nextNode())) {
    const len = n.textContent?.length ?? 0
    last = { node: n, offset: len }
    if (idx <= seen + len) return { node: n, offset: idx - seen }
    seen += len
  }
  return last
}

/**
 * Re-select `[from, to)` (SOURCE offsets) on the rendered title — the bubble
 * toolbar keeps its selection across a toggle this way, so marks can be stacked
 * with two clicks instead of re-dragging.
 */
export function selectSourceRange(root: HTMLElement, src: string, from: number, to: number) {
  const a = nodeAt(root, renderedIndexFor(src, from))
  const b = nodeAt(root, renderedIndexFor(src, to))
  const sel = window.getSelection()
  if (!a || !b || !sel) return
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Viewport rect of the current selection inside a <textarea>.
 *
 * A textarea has no DOM range to measure, so the text is mirrored into an
 * off-screen div that copies every metric affecting layout (font, padding,
 * border, width, wrapping) and the selected slice is wrapped in a span — the
 * standard trick, and the only way to anchor a bubble to the actual words
 * rather than to the whole field.
 */
export function textareaSelectionRect(el: HTMLTextAreaElement): DOMRect | null {
  const a = el.selectionStart
  const b = el.selectionEnd
  if (a === null || b === null || a === b) return null
  const cs = getComputedStyle(el)
  const div = document.createElement('div')
  const copy = [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'fontVariant',
    'letterSpacing',
    'lineHeight',
    'textIndent',
    'textTransform',
    'wordSpacing',
    'tabSize',
  ] as const
  for (const k of copy) div.style[k] = cs[k]
  div.style.position = 'fixed'
  div.style.top = '0'
  div.style.left = '0'
  div.style.visibility = 'hidden'
  div.style.whiteSpace = 'pre-wrap'
  div.style.overflowWrap = 'break-word'
  div.style.pointerEvents = 'none'
  div.textContent = el.value.slice(0, a)
  const span = document.createElement('span')
  // A zero-width span has no rect — a space keeps the measurement alive for a
  // selection that ends on a line break.
  span.textContent = el.value.slice(a, b) || ' '
  div.appendChild(span)
  div.appendChild(document.createTextNode(el.value.slice(b)))
  document.body.appendChild(div)
  const sr = span.getBoundingClientRect()
  const dr = div.getBoundingClientRect()
  document.body.removeChild(div)
  const er = el.getBoundingClientRect()
  return new DOMRect(
    er.left + (sr.left - dr.left) - el.scrollLeft,
    er.top + (sr.top - dr.top) - el.scrollTop,
    sr.width,
    sr.height
  )
}
