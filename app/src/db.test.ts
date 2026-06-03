import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  colorForName,
  deleteMember,
  dedupeSprints,
  exportAll,
  importAll,
  seedIfEmpty,
  __resetSeedLockForTests,
} from './db'

beforeEach(async () => {
  await db.transaction('rw', db.members, db.sprints, db.tasks, async () => {
    await db.members.clear()
    await db.sprints.clear()
    await db.tasks.clear()
  })
  __resetSeedLockForTests()
})

describe('uid', () => {
  it('returns unique strings', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()))
    expect(ids.size).toBe(100)
  })
})

describe('colorForName', () => {
  it('is deterministic', () => {
    expect(colorForName('Alice')).toBe(colorForName('Alice'))
  })
  it('returns a hex color from palette', () => {
    expect(colorForName('Bob')).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('seedIfEmpty', () => {
  it('seeds 3 members + 1 sprint + 1 task on empty db', async () => {
    await seedIfEmpty()
    expect(await db.members.count()).toBe(3)
    expect(await db.sprints.count()).toBe(1)
    expect(await db.tasks.count()).toBe(1)
  })

  it('is idempotent — does not re-seed when members exist', async () => {
    await seedIfEmpty()
    const firstMemberId = (await db.members.toArray())[0].id
    await seedIfEmpty()
    expect(await db.members.count()).toBe(3)
    expect((await db.members.toArray())[0].id).toBe(firstMemberId)
  })

  it('concurrent calls share one seed (StrictMode race protection)', async () => {
    await Promise.all([seedIfEmpty(), seedIfEmpty(), seedIfEmpty()])
    expect(await db.members.count()).toBe(3)
    expect(await db.sprints.count()).toBe(1)
  })
})

describe('deleteMember', () => {
  it('orphans tasks as Unassigned rather than deleting them', async () => {
    await seedIfEmpty()
    const member = (await db.members.toArray())[0]
    const sprint = (await db.sprints.toArray())[0]
    await db.tasks.add({
      id: uid(),
      title: 'orphan candidate',
      assigneeId: member.id,
      sprintId: sprint.id,
      status: 'todo',
      priority: 'normal',
      startDate: null,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
    })

    const before = await db.tasks.count()
    await deleteMember(member.id)
    const after = await db.tasks.toArray()

    expect(after.length).toBe(before)
    expect(after.every((t) => t.assigneeId !== member.id)).toBe(true)
    const orphan = after.find((t) => t.title === 'orphan candidate')
    expect(orphan?.assigneeId).toBeNull()
  })
})

describe('dedupeSprints', () => {
  it('returns 0 when no duplicates exist', async () => {
    await seedIfEmpty()
    expect(await dedupeSprints()).toBe(0)
  })

  it('merges duplicate-named sprints, keeping the one with most tasks', async () => {
    const s1 = { id: uid(), name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s2 = { id: uid(), name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s3 = { id: uid(), name: 'Sprint 2', startDate: '2026-06-15', endDate: '2026-06-28' }
    await db.sprints.bulkAdd([s1, s2, s3])
    // Give s2 more tasks → s2 should win
    const mk = (sid: string, title: string) => ({
      id: uid(), title, assigneeId: null, sprintId: sid,
      status: 'todo' as const, priority: 'normal' as const,
      startDate: null, dueDate: null, estimate: null, createdAt: Date.now(),
    })
    await db.tasks.bulkAdd([mk(s1.id, 'a'), mk(s2.id, 'b'), mk(s2.id, 'c'), mk(s3.id, 'd')])

    const removed = await dedupeSprints()
    expect(removed).toBe(1)
    expect(await db.sprints.count()).toBe(2)

    const remaining = await db.sprints.toArray()
    const keeperIds = remaining.map((s) => s.id)
    expect(keeperIds).toContain(s2.id) // s2 had more tasks
    expect(keeperIds).not.toContain(s1.id)

    // All 3 "Sprint 1" tasks now point to s2
    const movedTasks = await db.tasks.where('sprintId').equals(s2.id).toArray()
    expect(movedTasks.length).toBe(3)
  })

  it('is idempotent — second call returns 0', async () => {
    const s1 = { id: uid(), name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    const s2 = { id: uid(), name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    await db.sprints.bulkAdd([s1, s2])
    expect(await dedupeSprints()).toBe(1)
    expect(await dedupeSprints()).toBe(0)
  })
})

describe('export / import round-trip', () => {
  it('preserves all data', async () => {
    await seedIfEmpty()
    const snapshot = await exportAll()

    await db.members.clear()
    await db.sprints.clear()
    await db.tasks.clear()
    expect(await db.members.count()).toBe(0)

    await importAll(snapshot)

    expect(await db.members.count()).toBe(snapshot.members.length)
    expect(await db.sprints.count()).toBe(snapshot.sprints.length)
    expect(await db.tasks.count()).toBe(snapshot.tasks.length)
  })

  it('backfills missing startDate from legacy v1 exports (pre-startDate)', async () => {
    // Simulate an export created before Task.startDate existed.
    const legacy = {
      version: 1 as const,
      exportedAt: '2026-05-01T00:00:00Z',
      members: [{ id: 'm1', name: 'X', color: '#000000' }],
      sprints: [
        { id: 's1', name: 'Old Sprint', startDate: '2026-05-01', endDate: '2026-05-14' },
      ],
      // Note: no startDate field — legacy shape
      tasks: [
        {
          id: 't1',
          title: 'legacy task',
          assigneeId: 'm1',
          sprintId: 's1',
          status: 'todo' as const,
          priority: 'normal' as const,
          dueDate: null,
          estimate: null,
          createdAt: 0,
        },
      ],
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await importAll(legacy as any)
    const t = await db.tasks.get('t1')
    expect(t?.startDate).toBeNull()
    expect(t?.title).toBe('legacy task')
  })

  it('rejects unknown export version', async () => {
    await expect(
      importAll({ version: 99 as 1, exportedAt: '', members: [], sprints: [], tasks: [] })
    ).rejects.toThrow(/Unsupported/)
  })
})
