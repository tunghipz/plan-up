import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { daysOffInRange } from './members'

// daysOffInRange scopes a member's flat off-day list to one sprint's inclusive
// date range. See design-docs/members-and-days-off.md.
describe('daysOffInRange', () => {
  const days = [
    { date: '2026-05-30' }, // before
    { date: '2026-06-01', half: 'am' as const }, // start boundary
    { date: '2026-06-08' }, // inside
    { date: '2026-06-14' }, // end boundary
    { date: '2026-06-15' }, // after
  ]

  it('keeps only dates within [start, end], inclusive both ends', () => {
    const inRange = daysOffInRange(days, '2026-06-01', '2026-06-14')
    expect(inRange.map((d) => d.date)).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-14',
    ])
  })

  it('preserves the half-day flag on kept entries', () => {
    const inRange = daysOffInRange(days, '2026-06-01', '2026-06-14')
    expect(inRange[0]).toEqual({ date: '2026-06-01', half: 'am' })
  })

  it('returns empty when the sprint range contains no off-days', () => {
    expect(daysOffInRange(days, '2026-07-01', '2026-07-14')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const copy = [...days]
    daysOffInRange(days, '2026-06-01', '2026-06-14')
    expect(days).toEqual(copy)
  })
})
