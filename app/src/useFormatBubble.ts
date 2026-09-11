import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  marksAt,
  rangeToSource,
  selectSourceRange,
  textareaSelectionRect,
  toggleMark,
  type Mark,
} from './rich-text'

export interface BubbleState {
  rect: DOMRect
  /** Selection as SOURCE offsets (into the raw, marker-carrying string). */
  from: number
  to: number
  /** Marks covering the whole selection — those buttons render pressed. */
  active: Mark[]
  /** Which surface the selection lives on: the formatted div, or the editor. */
  origin: 'read' | 'edit'
}

/**
 * Selection-toolbar plumbing for a title, on BOTH surfaces:
 *
 * - **read mode** — the formatted `<div>`: the DOM selection is mapped onto the
 *   raw string, and put back after the toggle so marks can be stacked.
 * - **edit mode** — the `<textarea>`: `selectionStart/End` already ARE raw
 *   offsets; the rect comes from a mirror div (`textareaSelectionRect`).
 *
 * See design-docs/task-rich-text.md.
 *
 * `getValue` reads the CURRENT raw title (a ref, never a captured value — a
 * toggle must not write on top of a stale draft).
 */
export function useFormatBubble(
  rootRef: React.RefObject<HTMLElement | null>,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  getValue: () => string,
  setValue: (v: string) => void
) {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  // Source range to re-select once the rewritten value has rendered.
  const pendingRef = useRef<{ range: [number, number]; origin: 'read' | 'edit' } | null>(null)

  const close = useCallback(() => setBubble(null), [])

  /** Read mode: map the document selection onto the raw string. */
  const sync = useCallback(() => {
    const root = rootRef.current
    const sel = window.getSelection()
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setBubble(null)
    const range = sel.getRangeAt(0)
    if (!root.contains(range.commonAncestorContainer)) return setBubble(null)
    const src = getValue()
    const span = rangeToSource(src, root, range)
    if (!span) return setBubble(null)
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return setBubble(null)
    setBubble({ rect, from: span[0], to: span[1], active: marksAt(src, span[0], span[1]), origin: 'read' })
  }, [rootRef, getValue])

  /** Edit mode: the textarea's own selection, measured through a mirror div. */
  const syncTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return setBubble(null)
    const { selectionStart: a, selectionEnd: b } = el
    if (a === b) return setBubble(null)
    const rect = textareaSelectionRect(el)
    if (!rect) return setBubble(null)
    setBubble({ rect, from: a, to: b, active: marksAt(el.value, a, b), origin: 'edit' })
  }, [textareaRef])

  const toggle = useCallback(
    (mark: Mark) => {
      if (!bubble) return
      const r = toggleMark(getValue(), bubble.from, bubble.to, mark)
      pendingRef.current = { range: [r.start, r.end], origin: bubble.origin }
      setValue(r.value)
    },
    [bubble, getValue, setValue]
  )

  // Restore the selection (and re-measure the bubble) after a toggle rewrote the
  // title's markers.
  useLayoutEffect(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    const [from, to] = pending.range
    if (pending.origin === 'edit') {
      const el = textareaRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(from, to)
      syncTextarea()
      return
    }
    const root = rootRef.current
    if (!root) return
    selectSourceRange(root, getValue(), from, to)
    sync()
  })

  // While the bubble is up, follow the selection and dismiss on scroll/Escape.
  useEffect(() => {
    if (!bubble) return
    const origin = bubble.origin
    const onSel = () => (origin === 'edit' ? syncTextarea() : sync())
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBubble(null)
    document.addEventListener('selectionchange', onSel)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('selectionchange', onSel)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [bubble, sync, syncTextarea, close])

  return { bubble, sync, syncTextarea, toggle, close }
}
