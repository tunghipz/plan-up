import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  latestActiveSprint,
  nextSprintNumber,
  sprintToSelect,
} from './lib'
import { db, setSprintArchived, uid } from './db'
import type { Sprint } from './db'

// Minimal Sprint factory. Sprints are passed in startDate order (as the app
// queries them). See design-docs/sprint-archive.md.
function sp(n: number, archivedAt: number | null = null): Sprint {
  return {
    id: `s${n}`,
    projectId: 'p1',
    name: `Sprint ${n}`,
    startDate: `2026-${String(((n % 12) || 12)).padStart(2, '0')}-01`,
    endDate: `2026-${String(((n % 12) || 12)).padStart(2, '0')}-14`,
    ...(archivedAt != null ? { archivedAt } : {}),
  }
}

describe('latestActiveSprint', () => {
  it('returns the last non-archived sprint by order', () => {
    expect(latestActiveSprint([sp(38, 1), sp(39), sp(40)])?.id).toBe('s40')
  })
  it('skips a trailing archived sprint', () => {
    expect(latestActiveSprint([sp(44), sp(45), sp(46, 1)])?.id).toBe('s45')
  })
  it('returns null when all are archived', () => {
    expect(latestActiveSprint([sp(38, 1), sp(39, 1)])).toBeNull()
  })
  it('returns null for an empty list', () => {
    expect(latestActiveSprint([])).toBeNull()
  })
})

describe('nextSprintNumber', () => {
  it('increments past the highest Sprint N', () => {
    expect(nextSprintNumber([sp(44), sp(45), sp(46)])).toBe(47)
  })
  it('never reuses a number held by an archived sprint', () => {
    // active max is 46, but an archived Sprint 50 exists → next is 51, not 47
    expect(nextSprintNumber([sp(46), sp(50, 1)])).toBe(51)
  })
  it('falls back to count+1 when no name matches Sprint N', () => {
    const s: Sprint = { ...sp(1), name: 'Payments' }
    expect(nextSprintNumber([s])).toBe(2)
  })
})

describe('sprintToSelect', () => {
  it('picks the latest active sprint', () => {
    expect(sprintToSelect([sp(44), sp(45), sp(46, 1)])).toBe('s45')
  })
  it('falls back to the latest sprint when all are archived (never blank)', () => {
    expect(sprintToSelect([sp(38, 1), sp(39, 1)])).toBe('s39')
  })
  it('returns null for an empty list', () => {
    expect(sprintToSelect([])).toBeNull()
  })
})

describe('setSprintArchived', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.sprints, db.events, async () => {
      await db.sprints.clear()
      await db.events.clear()
    })
  })

  it('sets archivedAt and logs a sprint_archived event', async () => {
    const id = uid()
    await db.sprints.add({ id, projectId: 'p1', name: 'Sprint 1', startDate: '2026-06-15', endDate: '2026-06-28' })
    await setSprintArchived(id, true)
    const row = await db.sprints.get(id)
    expect(typeof row?.archivedAt).toBe('number')
    const events = await db.events.where('sprintId').equals(id).toArray()
    expect(events.some((e) => e.kind === 'sprint_archived')).toBe(true)
  })

  it('clears archivedAt and logs a sprint_unarchived event', async () => {
    const id = uid()
    await db.sprints.add({ id, projectId: 'p1', name: 'Sprint 1', startDate: '2026-06-15', endDate: '2026-06-28', archivedAt: 123 })
    await setSprintArchived(id, false)
    const row = await db.sprints.get(id)
    expect(row?.archivedAt).toBeUndefined()
    const events = await db.events.where('sprintId').equals(id).toArray()
    expect(events.some((e) => e.kind === 'sprint_unarchived')).toBe(true)
  })
})
