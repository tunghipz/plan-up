import { useRef } from 'react'
import { GripVertical } from 'lucide-react'

/**
 * Per-row drag state handed down from a list owner. `enabled` gates the whole
 * feature (typically only in the manual/natural order). Pointer-based: the grip
 * captures the pointer and reports cursor coordinates; the owner resolves which
 * row/lane is under the cursor via `elementFromPoint`. (Replaced the old HTML5
 * native-drag wiring, which was browser-fragile — see list-view.md / drag history.)
 *
 * Shared by the sprint List view (SprintView) and Collections (CollectionView).
 */
export type RowDrag = {
  id: string
  enabled: boolean
  dragging: boolean
  over: 'before' | 'after' | null
  onStart: () => void
  onMove: (clientX: number, clientY: number) => void
  onDrop: (clientX: number, clientY: number) => void
  onEnd: () => void
}

/**
 * Wires POINTER-based drag to a row/lane (replaced HTML5 native drag, which was
 * browser-fragile: dragstart/dragover/`preventDefault` timing and imperative
 * `draggable` toggling failed unpredictably across browsers — see drag history).
 * The grip's pointerdown captures the pointer, so every pointermove/up routes to
 * the grip no matter where the cursor goes; the owner resolves the row/lane under
 * the cursor via `elementFromPoint` + a data-attr. `grabbedRef` bounds the gesture
 * to this grip's own down→up. No `draggable`, so row text stays selectable at rest.
 * Returns the grip, the drop-slot indicator line, and props to spread on the root
 * (carries the hit-test data-attr for lanes; rows already carry their own id attr).
 */
export function useDragHandle(
  drag?: RowDrag,
  // Grip positioning/reveal classes. Defaults suit a task row (revealed on
  // `group/row` hover); member lanes pass a `group/card`-scoped variant.
  gripClassName = 'absolute left-0.5 top-1/2 -translate-y-1/2 z-20 grid place-items-center w-4 h-6 text-ink-faint/70 hover:text-ink-muted opacity-0 group-hover/row:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none',
  // When set, the owner's hit-testing finds this element by this data-attr; the
  // value is the item's id (e.g. 'data-lane-id'). Rows already carry their own
  // id attr on the row div, so they pass nothing here.
  dataAttr?: string
) {
  // True only between this grip's pointerdown and its pointerup — a ref so the
  // move/up handlers never read a stale "am I dragging" from a render closure.
  const grabbedRef = useRef(false)
  const enabled = !!drag?.enabled
  const grip = enabled ? (
    <button
      type="button"
      aria-label="Drag to reorder"
      // Pointer-based drag: capture the pointer on the grip so every move/up is
      // delivered here regardless of where the cursor goes; the owner resolves
      // the row/lane under the cursor via elementFromPoint. No HTML5 native drag
      // (browser-fragile) and no `draggable` toggling, so row text stays
      // selectable at rest.
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {
          // setPointerCapture can throw if the pointer is already gone; ignore.
        }
        grabbedRef.current = true
        // Suppress text selection across the page while dragging.
        document.body.style.userSelect = 'none'
        drag!.onStart()
      }}
      onPointerMove={(e) => {
        if (!grabbedRef.current) return
        drag!.onMove(e.clientX, e.clientY)
      }}
      onPointerUp={(e) => {
        if (!grabbedRef.current) return
        grabbedRef.current = false
        document.body.style.userSelect = ''
        try {
          ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
        } catch {
          // ignore
        }
        drag!.onDrop(e.clientX, e.clientY)
        drag!.onEnd()
      }}
      onPointerCancel={() => {
        if (!grabbedRef.current) return
        grabbedRef.current = false
        document.body.style.userSelect = ''
        drag!.onEnd()
      }}
      onClick={(e) => e.stopPropagation()}
      className={gripClassName}
    >
      <GripVertical size={14} />
    </button>
  ) : null

  const indicator = enabled ? (
    <>
      {drag!.over === 'before' && (
        <div className="absolute left-3 right-3 -top-px h-0.5 rounded-full bg-accent pointer-events-none z-20" />
      )}
      {drag!.over === 'after' && (
        <div className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-accent pointer-events-none z-20" />
      )}
    </>
  ) : null

  const rowProps: React.HTMLAttributes<HTMLDivElement> & Record<string, string> =
    enabled && dataAttr ? { [dataAttr]: drag!.id } : {}

  return { grip, indicator, rowProps, dragging: !!drag?.dragging }
}
