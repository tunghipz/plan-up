import { describe, expect, it } from 'vitest'
import { daysBetween, sprintExpirySignal } from './lib'

// A fixed 2-week sprint window (Mon..Sun) for all cases.
const START = '2026-06-30'
const END = '2026-07-12'

describe('daysBetween', () => {
  it('is 0 for the same day', () => {
    expect(daysBetween('2026-07-12', '2026-07-12')).toBe(0)
  })
  it('counts forward days', () => {
    expect(daysBetween('2026-07-12', '2026-07-16')).toBe(4)
    expect(daysBetween('2026-06-30', '2026-07-12')).toBe(12)
  })
  it('is negative when the target is earlier', () => {
    expect(daysBetween('2026-07-16', '2026-07-12')).toBe(-4)
  })
  it('is unaffected by DST (UTC-anchored)', () => {
    // US DST spring-forward 2026-03-08 — a naive local diff could report 0.
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1)
  })
})

describe('sprintExpirySignal', () => {
  it('past + open work + next exists → ended-open', () => {
    const s = sprintExpirySignal(START, END, '2026-07-16', 5, true)
    expect(s).toEqual({ kind: 'ended-open', endedDays: 4, endsInDays: 0 })
  })

  it('past + open work + NO next → ended-open-nonext', () => {
    const s = sprintExpirySignal(START, END, '2026-07-16', 5, false)
    expect(s).toEqual({ kind: 'ended-open-nonext', endedDays: 4, endsInDays: 0 })
  })

  it('past + all done → ended-done (regardless of hasNext)', () => {
    expect(sprintExpirySignal(START, END, '2026-07-16', 0, true)?.kind).toBe('ended-done')
    expect(sprintExpirySignal(START, END, '2026-07-16', 0, false)?.kind).toBe('ended-done')
  })

  it('lapsed one day ago → endedDays 1 (drives "ended yesterday")', () => {
    const s = sprintExpirySignal(START, END, '2026-07-13', 2, true)
    expect(s?.endedDays).toBe(1)
  })

  it('the end date itself is still in progress, not past', () => {
    // today === endDate → window is inclusive, so it ends today, not lapsed.
    const s = sprintExpirySignal(START, END, END, 3, true)
    expect(s).toEqual({ kind: 'ending-soon', endedDays: 0, endsInDays: 0 })
  })

  it('ends tomorrow → ending-soon with endsInDays 1', () => {
    const s = sprintExpirySignal(START, END, '2026-07-11', 3, true)
    expect(s).toEqual({ kind: 'ending-soon', endedDays: 0, endsInDays: 1 })
  })

  it('ends in 2 days → no signal (calm mid-sprint)', () => {
    expect(sprintExpirySignal(START, END, '2026-07-10', 3, true)).toBeNull()
  })

  it('mid-sprint with plenty of time → null', () => {
    expect(sprintExpirySignal(START, END, '2026-07-02', 8, true)).toBeNull()
  })

  it('upcoming sprint → null', () => {
    expect(sprintExpirySignal(START, END, '2026-06-20', 0, false)).toBeNull()
  })
})
