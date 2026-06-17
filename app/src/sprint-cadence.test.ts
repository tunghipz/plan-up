import { describe, it, expect } from 'vitest'
import {
  snapToMonday,
  nextMondayOnOrAfter,
  defaultSprintDates,
  upcomingMondays,
} from './lib'

// All dates ISO `yyyy-mm-dd`. June 2026 Mondays: 1, 8, 15, 22, 29.
// See design-docs/sprint-cadence.md.

describe('snapToMonday', () => {
  it('returns a Monday unchanged', () => {
    expect(snapToMonday('2026-06-15')).toBe('2026-06-15')
  })
  it('snaps a midweek day back to its week Monday', () => {
    expect(snapToMonday('2026-06-17')).toBe('2026-06-15') // Wed → Mon
  })
  it('snaps Sunday back to the Monday that started its week', () => {
    expect(snapToMonday('2026-06-21')).toBe('2026-06-15') // Sun → Mon
  })
  it('crosses a month boundary', () => {
    expect(snapToMonday('2026-07-01')).toBe('2026-06-29') // Wed → prev Mon
  })
  it('crosses a year boundary', () => {
    expect(snapToMonday('2026-01-01')).toBe('2025-12-29') // Thu → prev Mon
  })
})

describe('nextMondayOnOrAfter', () => {
  it('returns a Monday unchanged', () => {
    expect(nextMondayOnOrAfter('2026-06-15')).toBe('2026-06-15')
  })
  it('moves a Tuesday forward to the next Monday', () => {
    expect(nextMondayOnOrAfter('2026-06-16')).toBe('2026-06-22')
  })
  it('moves a Sunday forward to the next day (Monday)', () => {
    expect(nextMondayOnOrAfter('2026-06-21')).toBe('2026-06-22')
  })
})

describe('defaultSprintDates', () => {
  it('with no prior sprint, starts on the current week Monday', () => {
    expect(defaultSprintDates(null, '2026-06-17')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-28',
    })
  })
  it('chains back-to-back from a Sunday-ending sprint with no gap', () => {
    // last sprint ends Sun Jun 28 → next starts Mon Jun 29
    expect(defaultSprintDates('2026-06-28', '2026-06-17')).toEqual({
      startDate: '2026-06-29',
      endDate: '2026-07-12',
    })
  })
  it('forward-snaps a legacy mid-week end without overlapping it', () => {
    // legacy sprint ends Wed Jun 17 → next Monday strictly after is Jun 22
    const r = defaultSprintDates('2026-06-17', '2026-06-01')
    expect(r.startDate).toBe('2026-06-22')
    expect(r.endDate).toBe('2026-07-05')
    expect(r.startDate > '2026-06-17').toBe(true) // no overlap with the old sprint
  })
  it('always ends on a Sunday (start + 13 days)', () => {
    const r = defaultSprintDates(null, '2026-06-17')
    expect(new Date(r.endDate + 'T00:00:00Z').getUTCDay()).toBe(0) // Sunday
    expect(new Date(r.startDate + 'T00:00:00Z').getUTCDay()).toBe(1) // Monday
  })
})

describe('upcomingMondays', () => {
  it('returns n consecutive Mondays a week apart', () => {
    expect(upcomingMondays('2026-06-15', 3)).toEqual([
      '2026-06-15',
      '2026-06-22',
      '2026-06-29',
    ])
  })
  it('every entry is a Monday', () => {
    for (const iso of upcomingMondays('2026-06-15', 9)) {
      expect(new Date(iso + 'T00:00:00Z').getUTCDay()).toBe(1)
    }
  })
  it('crosses a month boundary', () => {
    expect(upcomingMondays('2026-06-29', 2)).toEqual(['2026-06-29', '2026-07-06'])
  })
})
