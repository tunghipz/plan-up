import { orderBetween } from './db'

// Pure list-reorder math shared by every pointer-drag list (sprint task rows,
// member lanes, collection items). The event wiring differs per site (hit-test
// attributes, lane semantics, persistence), but THIS logic — slot resolution,
// the own-gap no-op, float-midpoint collision — is where the drag bugs lived,
// so it is written once and unit-tested. See reorder.test.ts.

export interface DropSlot<T> {
  /** Index in `rest` (the list without the dragged item) to insert at. */
  insertAt: number
  before: T | null
  after: T | null
  /**
   * The drop lands back in the dragged item's own gap — the caller must
   * treat this as a no-op (writing would be harmless but renormalize noise).
   */
  ownGap: boolean
}

/**
 * Resolve where `draggedId` lands when released on `targetId` with a
 * before/after half. `arr` is the CURRENT ordered sibling list (dragged item
 * included). Returns null when the drop is invalid: unknown target, or the
 * target IS the dragged row (a plain grip click / a drag that came back home —
 * NOT an append-to-end).
 */
export function computeDropSlot<T>(
  arr: T[],
  idOf: (t: T) => string,
  draggedId: string,
  targetId: string,
  pos: 'before' | 'after'
): DropSlot<T> | null {
  if (targetId === draggedId) return null
  const fromIndex = arr.findIndex((t) => idOf(t) === draggedId)
  const rest = arr.filter((t) => idOf(t) !== draggedId)
  let insertAt = rest.findIndex((t) => idOf(t) === targetId)
  if (insertAt < 0) return null
  if (pos === 'after') insertAt += 1
  const before = rest[insertAt - 1] ?? null
  const after = rest[insertAt] ?? null
  // Own gap: the slot's neighbours are exactly the dragged item's current
  // neighbours (only meaningful when it was dragged within this same list).
  let ownGap = false
  if (fromIndex >= 0) {
    const left = arr[fromIndex - 1] ?? null
    const right = arr[fromIndex + 1] ?? null
    ownGap =
      (before ? idOf(before) : null) === (left ? idOf(left) : null) &&
      (after ? idOf(after) : null) === (right ? idOf(right) : null)
  }
  return { insertAt, before, after, ownGap }
}

/**
 * Append slot — dropping on a container's empty area below its rows (only
 * collections offer this). Not a targeted drop, so `ownGap` is true only when
 * the dragged item is already last in this list.
 */
export function computeAppendSlot<T>(
  arr: T[],
  idOf: (t: T) => string,
  draggedId: string
): DropSlot<T> {
  const rest = arr.filter((t) => idOf(t) !== draggedId)
  const before = rest[rest.length - 1] ?? null
  const last = arr[arr.length - 1]
  return {
    insertAt: rest.length,
    before,
    after: null,
    ownGap: !!last && idOf(last) === draggedId,
  }
}

/**
 * New fractional order for the slot, flagging float-precision exhaustion:
 * when the midpoint can't separate from a neighbour (many inserts into the
 * same gap), the caller must renormalize the whole list to clean integers
 * instead of writing a colliding order.
 */
export function resolveDropOrder<T>(
  slot: DropSlot<T>,
  orderOf: (t: T) => number
): { order: number; collides: boolean } {
  const beforeOrder = slot.before ? orderOf(slot.before) : null
  const afterOrder = slot.after ? orderOf(slot.after) : null
  const order = orderBetween(beforeOrder, afterOrder)
  const collides =
    (beforeOrder != null && order <= beforeOrder) ||
    (afterOrder != null && order >= afterOrder)
  return { order, collides }
}
