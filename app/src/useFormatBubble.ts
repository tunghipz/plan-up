import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  marksAt,
  rangeToSource,
  selectSourceRange,
  toggleMark,
  type Mark,
} from './rich-text'

export interface BubbleState {
  rect: DOMRect
  /** Selection as SOURCE offsets (markers included in the maths, not the range). */
  from: number
  to: number
  /** Marks covering the whole selection — those buttons render pressed. */
  active: Mark[]
}

/**
 * Selection-toolbar plumbing for a rendered (read-mode) title: map the DOM
 * selection onto the raw string, apply a mark, then put the selection back so a
 * second mark can be stacked. See design-docs/task-rich-text.md.
 *
 * `getValue` reads the CURRENT raw title (a ref, not a captured value — a toggle
 * must never write on top of a stale draft).
 */
export function useFormatBubble(
  rootRef: React.RefObject<HTMLElement | null>,
  getValue: () => string,
  setValue: (v: string) => void
) {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  // Source range to re-select once the rewritten value has rendered.
  const pendingRef = useRef<[number, number] | null>(null)

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
    setBubble({ rect, from: span[0], to: span[1], active: marksAt(src, span[0], span[1]) })
  }, [rootRef, getValue])

  const close = useCallback(() => setBubble(null), [])

  const toggle = useCallback(
    (mark: Mark) => {
      if (!bubble) return
      const r = toggleMark(getValue(), bubble.from, bubble.to, mark)
      pendingRef.current = [r.start, r.end]
      setValue(r.value)
    },
    [bubble, getValue, setValue]
  )

  // Restore the selection (and re-measure the bubble) after a toggle re-rendered
  // the title with different markers.
  useLayoutEffect(() => {
    const span = pendingRef.current
    const root = rootRef.current
    if (!span || !root) return
    pendingRef.current = null
    selectSourceRange(root, getValue(), span[0], span[1])
    sync()
  })

  // While the bubble is up, follow the selection and dismiss on scroll/Escape.
  useEffect(() => {
    if (!bubble) return
    const onSel = () => sync()
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
  }, [bubble, sync, close])

  return { bubble, sync, toggle, close }
}
