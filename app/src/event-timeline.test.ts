import { describe, expect, it } from 'vitest'
import {
  eventTiming,
  formatLength,
  formatRange,
  freeRuns,
  isLongRunning,
  monthBounds,
  overlapsById,
  windowFor,
} from './event-timeline'

// design-docs/collections.md "List cho lịch event"
const ev = (id: string, startDate: string | null, dueDate: string | null) => ({ id, title: id, startDate, dueDate })

describe('formatRange / formatLength', () => {
  it('merges start and end into one label', () => {
    expect(formatRange('2026-12-01', '2026-12-03')).toBe('Dec 1 – 3')
    expect(formatRange('2026-11-28', '2026-12-03')).toBe('Nov 28 – Dec 3')
    expect(formatRange('2026-09-07', '2026-09-07')).toBe('◆ Sep 7')
    expect(formatRange('2026-12-01', null)).toBe('Dec 1 – …')
    expect(formatRange(null, null)).toBeNull()
    expect(formatLength('2026-12-05', '2026-12-12')).toBe('8 days')
    expect(formatLength('2026-09-07', '2026-09-07')).toBe('1 day')
  })
})

describe('eventTiming', () => {
  const today = '2026-11-28'
  it('derives done / live / upcoming from the dates', () => {
    expect(eventTiming('2026-11-16', '2026-11-19', today)).toEqual({ kind: 'past', label: 'Done' })
    expect(eventTiming('2026-11-21', '2026-11-28', today)).toEqual({ kind: 'live', label: 'Ends today' })
    expect(eventTiming('2026-11-27', '2026-11-30', today)?.label).toBe('3 days left')
    expect(eventTiming('2026-11-29', '2026-12-01', today)?.label).toBe('Starts tomorrow')
    expect(eventTiming('2026-12-01', '2026-12-03', today)?.label).toBe('Starts in 3 days')
    expect(eventTiming(null, null, today)).toBeNull()
  })
})

describe('overlapsById', () => {
  it('flags shared days, ignoring the month-long backdrop', () => {
    const items = [
      ev('umbrella', '2026-12-01', '2026-12-31'),
      ev('streak', '2026-12-13', '2026-12-15'),
      ev('heist', '2026-12-13', '2026-12-15'),
      ev('egg', '2026-12-15', '2026-12-18'),
      ev('dig', '2026-12-20', '2026-12-27'),
      ev('undated', null, null),
    ]
    const m = overlapsById(items, (t) => t.title)
    expect(m.get('streak')).toEqual(['heist', 'egg'])
    expect(m.get('egg')).toEqual(['streak', 'heist'])
    expect(m.has('dig')).toBe(false)
    expect(m.has('umbrella')).toBe(false)
    expect(isLongRunning(items[0])).toBe(true)
  })
})

describe('freeRuns', () => {
  it('lists the days with no event running (backdrop does not count)', () => {
    const items = [
      ev('umbrella', '2026-12-01', '2026-12-31'),
      ev('a', '2026-12-01', '2026-12-03'),
      ev('b', '2026-12-05', '2026-12-12'),
      ev('c', '2026-12-13', '2026-12-18'),
      ev('d', '2026-12-20', '2026-12-27'),
    ]
    expect(freeRuns(items, '2026-12-01', '2026-12-31')).toEqual([
      ['2026-12-04', '2026-12-04'],
      ['2026-12-19', '2026-12-19'],
      ['2026-12-28', '2026-12-31'],
    ])
  })
})

describe('months', () => {
  it('bounds a month and spans a table in whole months', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28', label: 'February 2026' })
    expect(windowFor([ev('a', '2026-11-21', '2026-12-03'), ev('b', null, null)])).toEqual({
      start: '2026-11-01',
      end: '2026-12-31',
    })
    expect(windowFor([ev('b', null, null)])).toBeNull()
  })
})
