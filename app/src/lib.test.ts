import { describe, it, expect } from 'vitest'
import {
  parsePrereqSeqs,
  formatSeqRanges,
  sprintWorkdays,
  halfDayCells,
} from './lib'

describe('parsePrereqSeqs', () => {
  it('parses a comma/space list', () => {
    expect(parsePrereqSeqs('2, 3 5')).toEqual([2, 3, 5])
  })

  it('expands an inclusive range a-b', () => {
    expect(parsePrereqSeqs('2-5')).toEqual([2, 3, 4, 5])
  })

  it('mixes ranges and singles, sorted + de-duped', () => {
    expect(parsePrereqSeqs('8, 2-5, 3, 10')).toEqual([2, 3, 4, 5, 8, 10])
  })

  it('tolerates a reversed range (5-2 → 2..5)', () => {
    expect(parsePrereqSeqs('5-2')).toEqual([2, 3, 4, 5])
  })

  it('ignores non-numeric / non-positive tokens', () => {
    expect(parsePrereqSeqs('abc, 0, -1, 4')).toEqual([4])
  })

  it('empty input → empty list', () => {
    expect(parsePrereqSeqs('   ')).toEqual([])
  })
})

describe('formatSeqRanges', () => {
  it('collapses a consecutive run into a-b', () => {
    expect(formatSeqRanges([2, 3, 4, 5])).toBe('2-5')
  })

  it('keeps isolated numbers single, joins with ", "', () => {
    expect(formatSeqRanges([2, 4, 6])).toBe('2, 4, 6')
  })

  it('mixes runs and singles', () => {
    expect(formatSeqRanges([2, 3, 4, 5, 8, 10, 11])).toBe('2-5, 8, 10-11')
  })

  it('sorts and de-dupes the input', () => {
    expect(formatSeqRanges([5, 2, 3, 4, 2])).toBe('2-5')
  })

  it('round-trips with parsePrereqSeqs', () => {
    expect(parsePrereqSeqs(formatSeqRanges([2, 3, 4, 5, 8]))).toEqual([2, 3, 4, 5, 8])
  })
})

describe('sprintWorkdays', () => {
  // 2026-06-15 is a Monday; 06-20/06-21 are Sat/Sun.
  it('lists working days inclusive, excluding weekends', () => {
    expect(sprintWorkdays('2026-06-15', '2026-06-21')).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
    ])
  })

  it('a single weekday returns just itself', () => {
    expect(sprintWorkdays('2026-06-17', '2026-06-17')).toEqual(['2026-06-17'])
  })

  it('a weekend-only range is empty', () => {
    expect(sprintWorkdays('2026-06-20', '2026-06-21')).toEqual([])
  })

  it('start after end returns empty', () => {
    expect(sprintWorkdays('2026-06-21', '2026-06-15')).toEqual([])
  })
})

describe('halfDayCells', () => {
  const days = sprintWorkdays('2026-06-15', '2026-06-19') // Mon..Fri

  it('fills both halves across a full-day span, empty outside', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-15', dueDate: '2026-06-17', startTime: '08:00', endTime: '17:00' },
      days,
      []
    )
    expect(cells).toEqual([
      { am: 'active', pm: 'active' },
      { am: 'active', pm: 'active' },
      { am: 'active', pm: 'active' },
      { am: 'empty', pm: 'empty' },
      { am: 'empty', pm: 'empty' },
    ])
  })

  it('a PM start trims the start day AM', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-15', dueDate: '2026-06-15', startTime: '13:00', endTime: '17:00' },
      days,
      []
    )
    expect(cells[0]).toEqual({ am: 'empty', pm: 'active' })
  })

  it('a noon end trims the due day PM', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-16', dueDate: '2026-06-16', startTime: '08:00', endTime: '12:00' },
      days,
      []
    )
    expect(cells[1]).toEqual({ am: 'active', pm: 'empty' })
  })

  it('a full off-day inside the span shows off on both halves', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-15', dueDate: '2026-06-17', startTime: '08:00', endTime: '17:00' },
      days,
      [{ date: '2026-06-16' }]
    )
    expect(cells[1]).toEqual({ am: 'off', pm: 'off' })
  })

  it('a half off-day marks only its half off, the other stays active', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-15', dueDate: '2026-06-17', startTime: '08:00', endTime: '17:00' },
      days,
      [{ date: '2026-06-16', half: 'am' }]
    )
    expect(cells[1]).toEqual({ am: 'off', pm: 'active' })
  })

  it('an off-day outside the span stays empty (no pink noise)', () => {
    const cells = halfDayCells(
      { startDate: '2026-06-15', dueDate: '2026-06-16', startTime: '08:00', endTime: '17:00' },
      days,
      [{ date: '2026-06-19' }]
    )
    expect(cells[4]).toEqual({ am: 'empty', pm: 'empty' })
  })

  it('a manual task with no dates renders all empty', () => {
    const cells = halfDayCells(
      { startDate: null, dueDate: null, startTime: '08:00', endTime: '17:00' },
      days,
      []
    )
    expect(cells.every((c) => c.am === 'empty' && c.pm === 'empty')).toBe(true)
  })
})
