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
