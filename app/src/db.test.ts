import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  colorForName,
  deleteMember,
  deleteTask,
  addDependency,
  removeDependency,
  setDependencies,
  wouldCreateCycle,
  isTaskBlocked,
  computeStartEnd,
  addDays,
  dedupeSprints,
  exportAll,
  importAll,
  seedIfEmpty,
  __resetSeedLockForTests,
  type Task,
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
      sequence: 2,
      title: 'orphan candidate',
      assigneeId: member.id,
      sprintId: sprint.id,
      status: 'todo',
      priority: 'normal',
      startDate: null,
      dueDate: null,
      estimate: null,
      createdAt: Date.now(),
      dependsOn: [],
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
    let _seq = 100
    const mk = (sid: string, title: string) => ({
      id: uid(), sequence: _seq++, title, assigneeId: null, sprintId: sid,
      status: 'todo' as const, priority: 'normal' as const,
      startDate: null, dueDate: null, estimate: null, createdAt: Date.now(),
      dependsOn: [] as string[],
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

describe('task dependencies', () => {
  let _seq = 1
  const mkTask = (id: string, deps: string[] = [], status: Task['status'] = 'todo'): Task => ({
    id, sequence: _seq++, title: id, assigneeId: null, sprintId: 's',
    status, priority: 'normal',
    startDate: null, dueDate: null, estimate: null, createdAt: 0,
    dependsOn: deps,
  })

  it('wouldCreateCycle detects self-link', () => {
    expect(wouldCreateCycle('a', 'a', [])).toBe(true)
  })

  it('wouldCreateCycle detects A→B→A', () => {
    // existing: A depends on B; trying to make B depend on A → cycle
    const tasks = [mkTask('a', ['b']), mkTask('b')]
    expect(wouldCreateCycle('b', 'a', tasks)).toBe(true)
  })

  it('wouldCreateCycle allows independent chains', () => {
    const tasks = [mkTask('a'), mkTask('b'), mkTask('c')]
    expect(wouldCreateCycle('a', 'b', tasks)).toBe(false)
  })

  it('addDependency refuses cycles', async () => {
    await db.tasks.bulkAdd([mkTask('a', ['b']), mkTask('b')])
    const ok = await addDependency('b', 'a')
    expect(ok).toBe(false)
    const b = await db.tasks.get('b')
    expect(b?.dependsOn).toEqual([])
  })

  it('addDependency is idempotent', async () => {
    await db.tasks.bulkAdd([mkTask('a'), mkTask('b')])
    await addDependency('a', 'b')
    await addDependency('a', 'b')
    const a = await db.tasks.get('a')
    expect(a?.dependsOn).toEqual(['b'])
  })

  it('removeDependency strips one id', async () => {
    await db.tasks.bulkAdd([mkTask('a', ['b', 'c']), mkTask('b'), mkTask('c')])
    await removeDependency('a', 'b')
    const a = await db.tasks.get('a')
    expect(a?.dependsOn).toEqual(['c'])
  })

  it('deleteTask cascades — removes id from other tasks dependsOn', async () => {
    await db.tasks.bulkAdd([mkTask('a', ['b']), mkTask('b'), mkTask('c', ['b'])])
    await deleteTask('b')
    expect(await db.tasks.get('b')).toBeUndefined()
    const a = await db.tasks.get('a')
    const c = await db.tasks.get('c')
    expect(a?.dependsOn).toEqual([])
    expect(c?.dependsOn).toEqual([])
  })

  it('isTaskBlocked is true when a prereq is not done', () => {
    const a = mkTask('a', ['b'])
    const b = mkTask('b', [], 'in_progress')
    const byId = new Map([[a.id, a], [b.id, b]])
    expect(isTaskBlocked(a, byId)).toBe(true)
  })

  it('isTaskBlocked is false when all prereqs are done', () => {
    const a = mkTask('a', ['b'])
    const b = mkTask('b', [], 'done')
    const byId = new Map([[a.id, a], [b.id, b]])
    expect(isTaskBlocked(a, byId)).toBe(false)
  })

  it('done tasks are never blocked', () => {
    const a = mkTask('a', ['b'], 'done')
    const b = mkTask('b', [], 'todo')
    const byId = new Map([[a.id, a], [b.id, b]])
    expect(isTaskBlocked(a, byId)).toBe(false)
  })
})

describe('date computation', () => {
  it('addDays handles month rollover', () => {
    expect(addDays('2026-05-30', 3)).toBe('2026-06-02')
  })

  it('computeStartEnd: no prereqs → returns existing dates', () => {
    const t: Task = {
      id: 'a', sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-05',
      estimate: 5, createdAt: 0, dependsOn: [],
    }
    expect(computeStartEnd(t, new Map([[t.id, t]]))).toEqual({
      startDate: '2026-06-01', dueDate: '2026-06-05',
    })
  })

  it('computeStartEnd: start = latest prereq end + 1, end = start + (effort-1)', () => {
    const p1: Task = {
      id: 'p1', sequence: 1, title: 'p1', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-01',
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    const p2: Task = { ...p1, id: 'p2', sequence: 2, dueDate: '2026-06-03' }
    const a: Task = {
      id: 'a', sequence: 3, title: 'a', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: null, dueDate: null, estimate: 2,
      createdAt: 0, dependsOn: ['p1', 'p2'],
    }
    const byId = new Map([[p1.id, p1], [p2.id, p2], [a.id, a]])
    // latest end is p2 (06-03) → start 06-04, effort 2 → end 06-05
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-04', dueDate: '2026-06-05',
    })
  })

  it('computeStartEnd: missing effort defaults to 1 day (start = end)', () => {
    const p: Task = {
      id: 'p', sequence: 1, title: 'p', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-01',
      estimate: null, createdAt: 0, dependsOn: [],
    }
    const a: Task = { ...p, id: 'a', sequence: 2, estimate: null, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-02', dueDate: '2026-06-02',
    })
  })

  it('setDependencies recomputes dates and cascades forward', async () => {
    // Three tasks: a (1d, due 2026-06-01), b (2d, no deps), c (1d, depends on b)
    await db.tasks.bulkAdd([
      {
        id: 'a', sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: '2026-06-01', dueDate: '2026-06-01',
        estimate: 1, createdAt: 0, dependsOn: [],
      },
      {
        id: 'b', sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null,
        estimate: 2, createdAt: 1, dependsOn: [],
      },
      {
        id: 'c', sequence: 3, title: 'c', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null,
        estimate: 1, createdAt: 2, dependsOn: ['b'],
      },
    ])
    // Make b depend on a → b's dates should compute, then c's should follow.
    await setDependencies('b', ['a'])
    const b = await db.tasks.get('b')
    const c = await db.tasks.get('c')
    // a ends 06-01 → b starts 06-02, effort 2 → b ends 06-03
    expect(b?.startDate).toBe('2026-06-02')
    expect(b?.dueDate).toBe('2026-06-03')
    // b ends 06-03 → c starts 06-04, effort 1 → c ends 06-04
    expect(c?.startDate).toBe('2026-06-04')
    expect(c?.dueDate).toBe('2026-06-04')
  })

  it('setDependencies drops cycles silently', async () => {
    await db.tasks.bulkAdd([
      {
        id: 'a', sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null, estimate: 1, createdAt: 0,
        dependsOn: ['b'],
      },
      {
        id: 'b', sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null, estimate: 1, createdAt: 1,
        dependsOn: [],
      },
    ])
    // Cycle attempt: b depends on a, but a already depends on b.
    const saved = await setDependencies('b', ['a'])
    expect(saved).toEqual([])
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
