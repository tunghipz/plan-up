import { describe, it, expect } from 'vitest'
import { dayIndex, buildMonthGrid, assignLanes } from './lib'

describe('buildMonthGrid', () => {
  it('June 2026 is Mon-start, 5 weeks, today flagged, trailing July faint', () => {
    const g = buildMonthGrid(2026, 5, '2026-06-03') // month0=5 → June
    expect(g.weeks).toHaveLength(5)
    expect(g.gridStart).toBe(dayIndex('2026-06-01')) // Jun 1 is Monday
    expect(g.weeks[0].cells[0].day).toBe(1)
    const today = g.weeks[0].cells.find((c) => c.isToday)
    expect(today?.day).toBe(3)
    const jul1 = g.weeks[4].cells.find((c) => c.date === '2026-07-01')
    expect(jul1?.inMonth).toBe(false)
  })

  it('a month that needs 6 weeks returns 6', () => {
    // Aug 2026: Aug 1 is Saturday → spills to 6 rows
    const g = buildMonthGrid(2026, 7, '2026-08-01')
    expect(g.weeks.length).toBeGreaterThanOrEqual(5)
    expect(g.weeks[0].cells.some((c) => c.day === 1 && c.inMonth)).toBe(true)
  })
})

describe('assignLanes', () => {
  it('non-overlapping items share lane 0', () => {
    const lanes = assignLanes([
      { id: 'a', start: '2026-06-02', end: '2026-06-04' },
      { id: 'b', start: '2026-06-05', end: '2026-06-07' },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(0)
  })

  it('overlapping items get distinct lanes', () => {
    const lanes = assignLanes([
      { id: 'a', start: '2026-06-02', end: '2026-06-10' },
      { id: 'b', start: '2026-06-05', end: '2026-06-07' },
    ])
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('b')).toBe(1)
  })
})
