import { describe, expect, it } from 'vitest'
import { todayMark } from './lib'

// design-docs/today-marker.md
const T = '2026-11-13'

describe('todayMark', () => {
  it('due today is the strong mark', () => {
    expect(todayMark('2026-11-10', T, false, false, T)).toBe('due')
    expect(todayMark(T, T, false, false, T)).toBe('due')
  })
  it('today inside the span is live, including the start day', () => {
    expect(todayMark('2026-11-11', '2026-11-18', false, false, T)).toBe('live')
    expect(todayMark(T, '2026-11-14', false, false, T)).toBe('live')
  })
  it('outside the span, done, or undated is not marked', () => {
    expect(todayMark('2026-11-12', '2026-11-12', false, false, T)).toBeNull() // overdue stays red
    expect(todayMark('2026-11-16', '2026-11-19', false, false, T)).toBeNull()
    expect(todayMark('2026-11-10', T, true, false, T)).toBeNull()
    expect(todayMark(null, null, false, false, T)).toBeNull()
  })
  it('a single date is a one-day task', () => {
    expect(todayMark(null, T, false, false, T)).toBe('due')
    expect(todayMark(T, null, false, false, T)).toBe('due')
    expect(todayMark('2026-11-12', null, false, false, T)).toBeNull()
  })
  it('a milestone uses its date, not a span', () => {
    expect(todayMark(T, '2026-11-20', false, true, T)).toBe('due')
    expect(todayMark('2026-11-12', '2026-11-20', false, true, T)).toBeNull()
  })
})
