import { describe, it, expect } from 'vitest'
import { stabilizeRows, createRowStabilizer } from './stable-rows'

type Row = { id: string; title: string; dependsOn: string[]; note?: string | null }
const row = (id: string, title = id, dependsOn: string[] = []): Row => ({ id, title, dependsOn })

describe('stabilizeRows', () => {
  it('returns next as-is when there is no previous result', () => {
    const next = [row('a')]
    expect(stabilizeRows(undefined, next)).toBe(next)
    expect(stabilizeRows([], next)).toBe(next)
  })

  it('keeps the previous ARRAY when every row is unchanged and in order', () => {
    const prev = [row('a'), row('b', 'b', ['a'])]
    const next = [row('a'), row('b', 'b', ['a'])] // fresh objects, same data
    expect(stabilizeRows(prev, next)).toBe(prev)
  })

  it('keeps unchanged row objects and swaps in only the edited one', () => {
    const prev = [row('a'), row('b'), row('c')]
    const next = [row('a'), row('b', 'B!'), row('c')]
    const out = stabilizeRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
    expect(out[2]).toBe(prev[2])
  })

  it('compares nested arrays by value, so a dependsOn change counts', () => {
    const prev = [row('a', 'a', ['x'])]
    const next = [row('a', 'a', ['x', 'y'])]
    expect(stabilizeRows(prev, next)[0]).toBe(next[0])
  })

  it('treats an added/removed field as a change', () => {
    const prev: Row[] = [row('a')]
    const next: Row[] = [{ ...row('a'), note: null }]
    expect(stabilizeRows(prev, next)[0]).toBe(next[0])
  })

  it('a reorder or a removal yields a new array of the kept objects', () => {
    const prev = [row('a'), row('b'), row('c')]
    const reordered = stabilizeRows(prev, [row('b'), row('a'), row('c')])
    expect(reordered).not.toBe(prev)
    expect(reordered).toEqual([prev[1], prev[0], prev[2]])
    expect(reordered[0]).toBe(prev[1])
    const removed = stabilizeRows(prev, [row('a'), row('c')])
    expect(removed).toHaveLength(2)
    expect(removed[1]).toBe(prev[2])
  })
})

describe('createRowStabilizer', () => {
  it('stabilizes each call against the previous one', () => {
    const s = createRowStabilizer<Row>()
    const first = s.stabilize([row('a'), row('b')])
    const second = s.stabilize([row('a'), row('b')])
    expect(second).toBe(first)
    const third = s.stabilize([row('a', 'A'), row('b')])
    expect(third[1]).toBe(first[1])
    expect(third[0]).not.toBe(first[0])
  })
})
