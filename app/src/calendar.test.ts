import { describe, it, expect } from 'vitest'
import { dayIndex, buildMonthGrid, assignLanes, computeBarSegments } from './lib'

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
    expect(g.weeks.length).toBe(6)
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

describe('computeBarSegments', () => {
  const grid = buildMonthGrid(2026, 5, '2026-06-03') // June, gridStart=Jun1, gridEnd=Jul5

  it('a within-week item: one rounded segment', () => {
    const items = [{ id: 'a', start: '2026-06-02', end: '2026-06-04' }]
    const segs = computeBarSegments(items, grid, assignLanes(items))
    expect(segs).toHaveLength(1)
    expect(segs[0]).toMatchObject({ weekIndex: 0, colStart: 2, span: 3, roundL: true, roundR: true, leftChev: false, rightChev: false })
  })

  it('cross-week item splits with correct rounding', () => {
    const items = [{ id: 'a', start: '2026-06-20', end: '2026-06-23' }] // Sat..Tue
    const segs = computeBarSegments(items, grid, assignLanes(items))
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ weekIndex: 2, colStart: 6, span: 2, roundL: true, roundR: false })
    expect(segs[1]).toMatchObject({ weekIndex: 3, colStart: 1, span: 2, roundL: false, roundR: true })
  })

  it('item extending past gridEnd gets rightChev (no rounded right)', () => {
    const items = [{ id: 'a', start: '2026-06-10', end: '2026-07-20' }]
    const segs = computeBarSegments(items, grid, assignLanes(items))
    const last = segs[segs.length - 1]
    expect(last.rightChev).toBe(true)
    expect(last.roundR).toBe(false)
    expect(segs[0].roundL).toBe(true) // bắt đầu Jun 10 là start thật
  })

  it('item ending exactly on gridEnd has rightChev=false', () => {
    const items = [{ id: 'a', start: '2026-06-25', end: '2026-07-05' }] // Jul 5 = gridEnd for June 2026
    const segs = computeBarSegments(items, grid, assignLanes(items))
    const last = segs[segs.length - 1]
    expect(last.rightChev).toBe(false)
    expect(last.roundR).toBe(true)
  })

  it('item entirely outside grid produces no segments', () => {
    const items = [{ id: 'a', start: '2025-01-01', end: '2025-01-31' }]
    expect(computeBarSegments(items, grid, assignLanes(items))).toHaveLength(0)
  })
})
