import { describe, it, expect } from 'vitest'
import {
  parsePrereqSeqs,
  formatSeqRanges,
  sprintWorkdays,
  formatRelativeTime,
  formatTimestamp,
  formatShortDate,
  formatSprintRange,
  firstGrapheme,
  flattenDisplayOrder,
  daysOffWindow,
} from './lib'
import type { Task } from './db'

// Build a minimal Task for ordering tests — only id/parentId matter here.
const mkTask = (id: string, parentId?: string): Task =>
  ({ id, parentId: parentId ?? null }) as Task

// flattenDisplayOrder turns the on-screen member lanes (each already sorted in
// display order, group children nested under their head) into one flat
// top-to-bottom list, so "Chain prereqs" links tasks in the order the user
// actually sees. See design-docs/dependencies.md (Bulk actions).
describe('flattenDisplayOrder', () => {
  it('preserves each card sorted order (no groups)', () => {
    const card = [mkTask('a'), mkTask('b'), mkTask('c')]
    expect(flattenDisplayOrder([card]).map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('nests group children under their head in card order', () => {
    // Card order is [head, sibling, child-of-head]; the child renders under its
    // head, so the flat order is head, child, sibling.
    const card = [mkTask('head'), mkTask('sib'), mkTask('kid', 'head')]
    expect(flattenDisplayOrder([card]).map((t) => t.id)).toEqual([
      'head',
      'kid',
      'sib',
    ])
  })

  it('concatenates lanes top-to-bottom, unassigned last', () => {
    const lane1 = [mkTask('a1'), mkTask('a2')]
    const lane2 = [mkTask('b1')]
    const unassigned = [mkTask('u1')]
    expect(
      flattenDisplayOrder([lane1, lane2, unassigned]).map((t) => t.id)
    ).toEqual(['a1', 'a2', 'b1', 'u1'])
  })

  it('treats a child whose parent is in another card as top-level', () => {
    const lane1 = [mkTask('head')]
    const lane2 = [mkTask('orphanKid', 'head')]
    expect(flattenDisplayOrder([lane1, lane2]).map((t) => t.id)).toEqual([
      'head',
      'orphanKid',
    ])
  })
})

// firstGrapheme returns the first user-perceived character, so a member's emoji
// avatar keeps ZWJ sequences / flags / skin-tone modifiers intact instead of
// truncating them into mojibake. See design-docs/member-avatars.md.
describe('firstGrapheme', () => {
  it('returns the single character for plain ASCII', () => {
    expect(firstGrapheme('AB')).toBe('A')
  })

  it('keeps a ZWJ emoji family as one grapheme', () => {
    expect(firstGrapheme('👨‍👩‍👧 hello')).toBe('👨‍👩‍👧')
  })

  it('keeps a flag (regional indicator pair) as one grapheme', () => {
    expect(firstGrapheme('🇻🇳x')).toBe('🇻🇳')
  })

  it('trims leading whitespace and returns empty for blank input', () => {
    expect(firstGrapheme('   ')).toBe('')
    expect(firstGrapheme('')).toBe('')
  })
})

describe('formatSprintRange', () => {
  it('uses an arrow with the month on both sides, same month', () => {
    expect(formatSprintRange('2026-05-18', '2026-05-31')).toBe('May 18 → May 31')
  })
  it('uses an arrow across months', () => {
    expect(formatSprintRange('2026-06-29', '2026-07-12')).toBe('Jun 29 → Jul 12')
  })
})

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

// Days-off entry window = sprint span widened to whatever dates the member's
// tasks touch, so an off-day on an overdue date before the sprint start is
// pickable. See design-docs/members-and-days-off.md.
describe('daysOffWindow', () => {
  it('returns the sprint window unchanged when every task date sits inside', () => {
    expect(
      daysOffWindow('2026-07-20', '2026-07-31', ['2026-07-22', '2026-07-28'])
    ).toEqual({ start: '2026-07-20', end: '2026-07-31' })
  })

  it('widens start down to an overdue task date before the sprint start', () => {
    expect(
      daysOffWindow('2026-07-20', '2026-07-31', ['2026-07-17', '2026-07-25'])
    ).toEqual({ start: '2026-07-17', end: '2026-07-31' })
  })

  it('widens end up to a task date after the sprint end', () => {
    expect(
      daysOffWindow('2026-07-20', '2026-07-31', ['2026-08-03'])
    ).toEqual({ start: '2026-07-20', end: '2026-08-03' })
  })

  it('ignores null/undefined/empty dates', () => {
    expect(
      daysOffWindow('2026-07-20', '2026-07-31', [null, undefined, '', '2026-07-14'])
    ).toEqual({ start: '2026-07-14', end: '2026-07-31' })
  })

  it('no task dates leaves the window as the bare sprint span', () => {
    expect(daysOffWindow('2026-07-20', '2026-07-31', [])).toEqual({
      start: '2026-07-20',
      end: '2026-07-31',
    })
  })
})
