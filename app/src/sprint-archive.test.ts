import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  latestActiveSprint,
  nextSprintNumber,
  sprintToSelect,
} from './lib'
import { db, deleteSprint, setSprintArchived, uid, updateSprint } from './db'
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
    await db.transaction('rw', db.sprints, db.tasks, db.events, async () => {
      await db.sprints.clear()
      await db.tasks.clear()
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

describe('updateSprint', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.sprints, async () => {
      await db.sprints.clear()
    })
  })

  it('updates the Monday start, derives the end date, and trims note', async () => {
    const id = uid()
    await db.sprints.add({
      id,
      projectId: 'p1',
      name: 'Sprint 1',
      startDate: '2026-06-15',
      endDate: '2026-06-28',
    })

    const updated = await updateSprint({
      sprintId: id,
      startDate: '2026-06-22',
      note: '  Release polish  ',
    })

    expect(updated?.startDate).toBe('2026-06-22')
    expect(updated?.endDate).toBe('2026-07-05')
    expect(updated?.note).toBe('Release polish')
    await expect(db.sprints.get(id)).resolves.toMatchObject({
      startDate: '2026-06-22',
      endDate: '2026-07-05',
      note: 'Release polish',
    })
  })

  it('rejects non-Monday starts', async () => {
    const id = uid()
    await db.sprints.add({
      id,
      projectId: 'p1',
      name: 'Sprint 1',
      startDate: '2026-06-15',
      endDate: '2026-06-28',
    })

    await expect(updateSprint({ sprintId: id, startDate: '2026-06-23' })).rejects.toThrow(
      'Sprint start must be a Monday'
    )
  })
})

describe('deleteSprint', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.sprints, db.tasks, db.events, async () => {
      await db.sprints.clear()
      await db.tasks.clear()
      await db.events.clear()
    })
  })

  it('deletes the sprint, its tasks, its events, and cleans dependency references', async () => {
    const s1 = uid()
    const s2 = uid()
    const t1 = uid()
    const t2 = uid()
    const dependent = uid()
    await db.sprints.bulkAdd([
      { id: s1, projectId: 'p1', name: 'Sprint 1', startDate: '2026-06-15', endDate: '2026-06-28' },
      { id: s2, projectId: 'p1', name: 'Sprint 2', startDate: '2026-06-29', endDate: '2026-07-12' },
    ])
    await db.tasks.bulkAdd([
      {
        id: t1,
        projectId: 'p1',
        sequence: 1,
        title: 'Deleted A',
        assigneeId: null,
        sprintId: s1,
        status: 'todo',
        priority: 'normal',
        startDate: '2026-06-15',
        dueDate: null,
        estimate: null,
        createdAt: 1,
        dependsOn: [],
      },
      {
        id: t2,
        projectId: 'p1',
        sequence: 2,
        title: 'Deleted B',
        assigneeId: null,
        sprintId: s1,
        status: 'todo',
        priority: 'normal',
        startDate: '2026-06-15',
        dueDate: null,
        estimate: null,
        createdAt: 2,
        dependsOn: [],
      },
      {
        id: dependent,
        projectId: 'p1',
        sequence: 1,
        title: 'Remaining',
        assigneeId: null,
        sprintId: s2,
        status: 'todo',
        priority: 'normal',
        startDate: '2026-06-29',
        dueDate: null,
        estimate: null,
        createdAt: 3,
        dependsOn: [t1, t2],
      },
    ])
    await db.events.add({
      id: uid(),
      projectId: 'p1',
      sprintId: s1,
      taskId: null,
      taskSeq: null,
      taskTitle: null,
      kind: 'sprint_started',
      from: null,
      to: null,
      ts: 1,
    })

    await deleteSprint(s1)

    await expect(db.sprints.get(s1)).resolves.toBeUndefined()
    await expect(db.tasks.where('sprintId').equals(s1).toArray()).resolves.toEqual([])
    await expect(db.events.where('sprintId').equals(s1).toArray()).resolves.toEqual([])
    await expect(db.tasks.get(dependent)).resolves.toMatchObject({ dependsOn: [] })
  })
})
