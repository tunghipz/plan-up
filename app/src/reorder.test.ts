import { describe, it, expect } from 'vitest'
import { computeDropSlot, computeAppendSlot, resolveDropOrder } from './reorder'

type Row = { id: string; order: number }
const idOf = (r: Row) => r.id
const orderOf = (r: Row) => r.order
const rows = (...ids: string[]): Row[] => ids.map((id, i) => ({ id, order: (i + 1) * 10 }))

describe('computeDropSlot', () => {
  const arr = rows('a', 'b', 'c', 'd')

  it('drops before / after a target', () => {
    const s1 = computeDropSlot(arr, idOf, 'd', 'b', 'before')!
    expect(s1.insertAt).toBe(1)
    expect(s1.before?.id).toBe('a')
    expect(s1.after?.id).toBe('b')
    expect(s1.ownGap).toBe(false)

    const s2 = computeDropSlot(arr, idOf, 'a', 'c', 'after')!
    expect(s2.before?.id).toBe('c')
    expect(s2.after?.id).toBe('d')
  })

  it('releasing on the dragged row itself is INVALID, not append-to-end', () => {
    // The regression that shipped as a Critical bug: a plain grip click used
    // to fall through to "append to the section's end".
    expect(computeDropSlot(arr, idOf, 'b', 'b', 'before')).toBeNull()
    expect(computeDropSlot(arr, idOf, 'b', 'b', 'after')).toBeNull()
  })

  it('unknown target is invalid', () => {
    expect(computeDropSlot(arr, idOf, 'a', 'zzz', 'before')).toBeNull()
  })

  it('flags the own-gap no-op (both directions around the dragged row)', () => {
    // b dragged, released just after a (= before its own position) → own gap.
    expect(computeDropSlot(arr, idOf, 'b', 'a', 'after')!.ownGap).toBe(true)
    // b dragged, released just before c → also its own gap.
    expect(computeDropSlot(arr, idOf, 'b', 'c', 'before')!.ownGap).toBe(true)
    // b dragged past c → a real move.
    expect(computeDropSlot(arr, idOf, 'b', 'c', 'after')!.ownGap).toBe(false)
  })

  it('cross-list drop (dragged not in arr) never reads as own gap', () => {
    const other = rows('x', 'y')
    const s = computeDropSlot(other, idOf, 'a', 'y', 'after')!
    expect(s.ownGap).toBe(false)
    expect(s.before?.id).toBe('y')
    expect(s.after).toBeNull()
  })

  // Regression (2026-07-06): the hover handler must light the insertion line
  // ONLY where a drop would actually move the row — i.e. `slot && !slot.ownGap`,
  // the exact predicate the drop uses. It used to draw the line for any hovered
  // neighbour, so the ~2-row band around the dragged row's own gap showed a line
  // that did nothing on release — the row looked stuck (see the drag bug video).
  it('indicator-visible predicate matches the drop outcome around the own gap', () => {
    // Video scenario: displayed order [Task1, Task3, Task2, Task4], drag Task3.
    const list = rows('T1', 'T3', 'T2', 'T4')
    const shows = (target: string, pos: 'before' | 'after') => {
      const s = computeDropSlot(list, idOf, 'T3', target, pos)
      return !!s && !s.ownGap // what hoverRow now uses to decide the line
    }
    // Own-gap band around Task3 → NO line (matches the no-op drop):
    expect(shows('T1', 'after')).toBe(false) // bottom half of the row above
    expect(shows('T2', 'before')).toBe(false) // top half of the row below
    // Real moves → line shows (matches a repositioning drop):
    expect(shows('T2', 'after')).toBe(true) // past Task2 → drops below it
    expect(shows('T1', 'before')).toBe(true) // to the very top
    expect(shows('T4', 'after')).toBe(true) // to the very bottom
  })
})

describe('computeAppendSlot', () => {
  it('appends to the end of another list', () => {
    const s = computeAppendSlot(rows('x', 'y'), idOf, 'a')
    expect(s.insertAt).toBe(2)
    expect(s.before?.id).toBe('y')
    expect(s.after).toBeNull()
    expect(s.ownGap).toBe(false)
  })

  it('appending within the same list is own-gap only when already last', () => {
    const arr = rows('a', 'b', 'c')
    expect(computeAppendSlot(arr, idOf, 'c').ownGap).toBe(true)
    expect(computeAppendSlot(arr, idOf, 'a').ownGap).toBe(false)
  })
})

describe('resolveDropOrder', () => {
  it('midpoints between neighbours', () => {
    const arr = rows('a', 'b', 'c')
    const slot = computeDropSlot(arr, idOf, 'c', 'a', 'after')!
    const { order, collides } = resolveDropOrder(slot, orderOf)
    expect(order).toBeGreaterThan(10)
    expect(order).toBeLessThan(20)
    expect(collides).toBe(false)
  })

  it('flags float-precision exhaustion as a collision', () => {
    // Neighbours so close no midpoint fits between them.
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 1 + Number.EPSILON }
    const arr = [a, b, { id: 'z', order: 99 }]
    const slot = computeDropSlot(arr, idOf, 'z', 'a', 'after')!
    expect(resolveDropOrder(slot, orderOf).collides).toBe(true)
  })

  it('open-ended slots (start / end of list) never collide', () => {
    const arr = rows('a', 'b')
    const first = computeDropSlot(arr, idOf, 'b', 'a', 'before')!
    expect(resolveDropOrder(first, orderOf).collides).toBe(false)
    const end = computeAppendSlot(rows('x'), idOf, 'b')
    expect(resolveDropOrder(end, orderOf).collides).toBe(false)
  })
})
