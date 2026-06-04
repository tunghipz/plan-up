import { describe, it, expect } from 'vitest'
import { parsePrereqSeqs, formatSeqRanges } from './lib'

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
