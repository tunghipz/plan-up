import { describe, it, expect } from 'vitest'
import {
  parsePrereqSeqs,
  formatSeqRanges,
  sprintWorkdays,
  formatRelativeTime,
  formatTimestamp,
  formatShortDate,
} from './lib'

describe('formatRelativeTime', () => {
  const now = new Date('2026-06-05T12:00:00').getTime()
  const ago = (ms: number) => now - ms
  it('shows "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('just now')
  })
  it('shows minutes', () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5m ago')
  })
  it('shows hours', () => {
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3h ago')
  })
  it('shows days up to 7', () => {
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe('2d ago')
  })
  it('flips to an absolute MMM d date past 7 days', () => {
    const ts = new Date('2026-05-19T09:00:00').getTime()
    expect(formatRelativeTime(ts, now)).toBe('May 19')
  })
})

describe('formatTimestamp', () => {
  it('formats dd/mm HH:mm zero-padded', () => {
    const ts = new Date('2026-06-05T09:07:00').getTime()
    expect(formatTimestamp(ts)).toBe('05/06 09:07')
  })
})

describe('formatShortDate', () => {
  // Parses y-m-d by components, so the output is identical in every timezone.
  // The old `new Date(str)` impl rendered the previous day ("Jun 7") in any
  // UTC-negative zone — these pin the off-by-one shut.
  it('formats MMM d from a yyyy-mm-dd string', () => {
    expect(formatShortDate('2026-06-08')).toBe('Jun 8')
  })
  it('handles Jan and Dec boundaries without month drift', () => {
    expect(formatShortDate('2026-01-01')).toBe('Jan 1')
    expect(formatShortDate('2026-12-31')).toBe('Dec 31')
  })
})

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

  it('ignores an absurdly wide range instead of freezing', () => {
    expect(parsePrereqSeqs('1-999999999')).toEqual([])
    // a normal range alongside it still parses
    expect(parsePrereqSeqs('1-999999999, 3, 4')).toEqual([3, 4])
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
