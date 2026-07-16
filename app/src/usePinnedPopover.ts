import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'

/**
 * Screen position for a fixed-position popover — CSS offsets in px. Sites pick
 * their own keys ({top,left} or {top,right}); the hook only shallow-compares.
 */
type Pos = Record<string, number>

/** Same offsets → same position (bails the setPos so re-pins can't loop). */
function samePos(a: Pos, b: Pos): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.is(a[k], b[k]))
  )
}

/**
 * Shared EVENT WIRING for a portal popover pinned to an anchor — the idiom
 * copy-pasted across StatusPill / CalendarPopover / AvatarPicker / PersonRow /
 * BarPopover / … The hook owns the listeners; each site keeps its own geometry
 * in `place` (the pin math genuinely differs per site: flip-up thresholds,
 * right-alignment, measured vs estimated heights).
 *
 * What it wires while `open`:
 * - **Positioning** — `place()` runs in a layout effect after EVERY committed
 *   render (a superset of the per-site dependency lists this replaces, e.g.
 *   AvatarPicker re-pins when its panel height changes). The result is state
 *   returned to the caller; an unchanged position bails, so this can't loop.
 *   Runs pre-paint, so the initial off-screen/unmeasured frame never paints.
 * - **Outside mousedown** — closes unless the press lands inside `popRef`,
 *   `anchorRef`, or an element matching `outsideIgnore` (nested portaled
 *   calendars mark themselves `[data-calendar-popover]` and must count as
 *   "inside", else picking a day closes the host before the click lands).
 * - **Escape** — calls `onEscape` (default `onClose`; pass `null` for popovers
 *   that deliberately don't close on Escape).
 * - **Scroll / resize** — `'repin'` re-runs `place` (scroll uses capture so any
 *   scroll container counts); `'close'` closes instead (popovers anchored to a
 *   snapshot DOMRect can't follow a scrolling anchor); `'none'` ignores
 *   (absolute popovers that scroll with their anchor).
 *
 * `deferListeners` postpones attaching everything by a macrotask — for
 * popovers opened by a click on the page (Gantt/calendar bars) where the
 * opening mousedown would otherwise land on the fresh listeners and
 * immediately self-close.
 *
 * Handlers and `place` are read through latest-refs, so inline closures are
 * fine — listeners are not re-attached when their identity changes.
 *
 * @returns The last `place()` result, or `null` before the first pin (and for
 *   sites with no `place`, which position some other way).
 */
export function usePinnedPopover<P extends Pos>(opts: {
  /** Gate for popovers that stay mounted while closed. Omit when the popover component only mounts open. */
  open?: boolean
  onClose: () => void
  /** Escape handler override (e.g. refocus the trigger first). `null` = Escape does not close. */
  onEscape?: (() => void) | null
  /** Trigger element — presses inside it don't count as "outside" (the trigger's own onClick toggles). */
  anchorRef?: React.RefObject<HTMLElement | null>
  /** Popover element — for the outside-press check (and typically measured by `place`). */
  popRef?: React.RefObject<HTMLElement | null>
  /** Site-specific pin math: anchor rect + viewport → offsets. Return null/undefined to keep the previous position (anchor unmounted mid-scroll). */
  place?: () => P | null | undefined
  /** Default: `'repin'` when `place` is given, else `'none'`. */
  onScroll?: 'repin' | 'close' | 'none'
  /** Attach listeners on a setTimeout(0) so the opening click can't self-close. */
  deferListeners?: boolean
  /** CSS selector whose matches count as "inside" (e.g. `'[data-calendar-popover]'`). */
  outsideIgnore?: string
}): P | null {
  const { open = true, place, deferListeners = false, outsideIgnore } = opts
  const onScroll = opts.onScroll ?? (place ? 'repin' : 'none')
  const { anchorRef, popRef } = opts

  const [pos, setPos] = useState<P | null>(null)

  // Latest-refs so listeners (bound once per open) always see the current
  // handlers/geometry without re-wiring on every identity change.
  const placeRef = useRef(place)
  const onCloseRef = useRef(opts.onClose)
  const onEscapeRef = useRef(opts.onEscape)
  useLayoutEffect(() => {
    placeRef.current = place
    onCloseRef.current = opts.onClose
    onEscapeRef.current = opts.onEscape
  })

  const pin = useCallback(() => {
    const next = placeRef.current?.()
    if (!next) return
    setPos((prev) => (prev && samePos(prev, next) ? prev : next))
  }, [])

  // Pin before paint on every render while open — see the contract above.
  useLayoutEffect(() => {
    if (open) pin()
  })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef?.current?.contains(t)) return
      if (anchorRef?.current?.contains(t)) return
      if (outsideIgnore && t instanceof Element && t.closest(outsideIgnore))
        return
      onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const esc = onEscapeRef.current
      if (esc === null) return
      ;(esc ?? onCloseRef.current)()
    }
    const closeOnScroll = () => onCloseRef.current()
    const attach = () => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      if (onScroll === 'repin') {
        window.addEventListener('scroll', pin, true)
        window.addEventListener('resize', pin)
      } else if (onScroll === 'close') {
        window.addEventListener('scroll', closeOnScroll, true)
      }
    }
    let timer: number | undefined
    if (deferListeners) timer = window.setTimeout(attach, 0)
    else attach()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
      window.removeEventListener('scroll', closeOnScroll, true)
    }
  }, [open, onScroll, deferListeners, outsideIgnore, anchorRef, popRef, pin])

  return pos
}
