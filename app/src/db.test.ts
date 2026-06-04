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
  findCyclePath,
  isTaskBlocked,
  computeStartEnd,
  computeWorkingPlan,
  recomputeDates,
  recomputeAllDates,
  addDays,
  addBusinessDays,
  nextBusinessDay,
  isWeekend,
  setMemberDaysOff,
  computeWorkingTimes,
  moveUnfinishedToNextSprint,
  createProject,
  deleteProject,
  updateProject,
  nextSequence,
  dedupeSprints,
  exportAll,
  importAll,
  seedIfEmpty,
  __resetSeedLockForTests,
  type Task,
  type Member,
} from './db'

// All tests run inside this synthetic project. Saves having to thread a
// projectId everywhere just to satisfy the not-null schema field.
const P = 'test-project'

beforeEach(async () => {
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
    async () => {
      await db.tasks.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.projects.clear()
      await db.projects.add({ id: P, name: 'Test', createdAt: 0 })
    }
  )
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
      projectId: member.projectId,
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
    const s1 = { id: uid(), projectId: P, name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s2 = { id: uid(), projectId: P, name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s3 = { id: uid(), projectId: P, name: 'Sprint 2', startDate: '2026-06-15', endDate: '2026-06-28' }
    await db.sprints.bulkAdd([s1, s2, s3])
    // Give s2 more tasks → s2 should win
    let _seq = 100
    const mk = (sid: string, title: string) => ({
      id: uid(), projectId: P, sequence: _seq++, title, assigneeId: null, sprintId: sid,
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
    const s1 = { id: uid(), projectId: P, name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    const s2 = { id: uid(), projectId: P, name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    await db.sprints.bulkAdd([s1, s2])
    expect(await dedupeSprints()).toBe(1)
    expect(await dedupeSprints()).toBe(0)
  })

  it('renumbers merged tasks so sequences stay unique in the keeper', async () => {
    const s1 = { id: 'k', projectId: P, name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    const s2 = { id: 'd', projectId: P, name: 'Dup', startDate: '2026-01-01', endDate: '2026-01-14' }
    await db.sprints.bulkAdd([s1, s2])
    const mk = (id: string, sid: string, seq: number) => ({
      id, projectId: P, sequence: seq, title: id, assigneeId: null, sprintId: sid,
      status: 'todo' as const, priority: 'normal' as const,
      startDate: null, dueDate: null, estimate: null, createdAt: 0, dependsOn: [] as string[],
    })
    // Both sprints number their tasks 1 & 2 — merge must renumber, not collide.
    await db.tasks.bulkAdd([mk('k1', 'k', 1), mk('k2', 'k', 2), mk('d1', 'd', 1), mk('d2', 'd', 2)])
    await dedupeSprints()
    const keeperId = (await db.sprints.toArray())[0].id
    const inKeeper = await db.tasks.where('sprintId').equals(keeperId).toArray()
    expect(inKeeper).toHaveLength(4)
    expect(new Set(inKeeper.map((t) => t.sequence)).size).toBe(4) // no collision
  })
})

describe('task dependencies', () => {
  let _seq = 1
  const mkTask = (id: string, deps: string[] = [], status: Task['status'] = 'todo'): Task => ({
    id, projectId: P, sequence: _seq++, title: id, assigneeId: null, sprintId: 's',
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

  it('findCyclePath returns the loop path when a cycle would form', () => {
    // existing: d→c, c→a (a depends on c, c depends on d... wait set up chain)
    // chain: 9→8, 8→6, 6→7 ; adding 7→9 closes the loop.
    const tasks = [
      mkTask('t7'),
      mkTask('t6', ['t7']),
      mkTask('t8', ['t6']),
      mkTask('t9', ['t8']),
    ]
    // path from t9 back to t7 (existing edges): t9→t8→t6→t7
    expect(findCyclePath('t7', 't9', tasks)).toEqual(['t9', 't8', 't6', 't7'])
  })

  it('findCyclePath returns null when no cycle', () => {
    const tasks = [mkTask('t7'), mkTask('t10')]
    expect(findCyclePath('t7', 't10', tasks)).toBeNull()
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

  it('isWeekend flags Sat/Sun, not Mon-Fri', () => {
    expect(isWeekend('2026-06-06')).toBe(true)  // Sat
    expect(isWeekend('2026-06-07')).toBe(true)  // Sun
    expect(isWeekend('2026-06-05')).toBe(false) // Fri
    expect(isWeekend('2026-06-08')).toBe(false) // Mon
  })

  it('nextBusinessDay: weekday unchanged, weekend → next Monday', () => {
    expect(nextBusinessDay('2026-06-05')).toBe('2026-06-05') // Fri
    expect(nextBusinessDay('2026-06-06')).toBe('2026-06-08') // Sat → Mon
    expect(nextBusinessDay('2026-06-07')).toBe('2026-06-08') // Sun → Mon
  })

  it('addBusinessDays skips weekends', () => {
    // Mon 06-01 + 4 business days = Fri 06-05
    expect(addBusinessDays('2026-06-01', 4)).toBe('2026-06-05')
    // Fri 06-05 + 1 business day = Mon 06-08 (skips Sat/Sun)
    expect(addBusinessDays('2026-06-05', 1)).toBe('2026-06-08')
    // Mon 06-01 + 5 business days = Mon 06-08 (full week)
    expect(addBusinessDays('2026-06-01', 5)).toBe('2026-06-08')
  })

  it('computeStartEnd: prereq ends Friday → dependent starts Monday', () => {
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-05', dueDate: '2026-06-05', // Friday
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 3, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    // Fri + 1 calendar = Sat → next Monday 06-08, effort 3 → 06-08, 06-09, 06-10
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-08', dueDate: '2026-06-10',
    })
  })

  it('addBusinessDays skips member-specific off-days', () => {
    // Mon 06-01 + 4 with Wed 06-03 off → Mon, Tue, [skip Wed], Thu, Fri, Mon
    // Wait: counting business days FORWARD from Mon. addBusinessDays(start, n)
    // advances n working days, returning the n-th. With 06-03 off, the days
    // counted are Tue, Thu, Fri, Mon → end = Mon 06-08.
    const off = new Set(['2026-06-03'])
    expect(addBusinessDays('2026-06-01', 4, off)).toBe('2026-06-08')
  })

  it('nextBusinessDay skips member-specific off-days', () => {
    const off = new Set(['2026-06-08']) // Monday off
    // 06-06 Sat → skip Sat, Sun, Mon (off) → Tue 06-09
    expect(nextBusinessDay('2026-06-06', off)).toBe('2026-06-09')
  })

  it('computeStartEnd uses assignee daysOff', () => {
    const member: Member = {
      id: 'm1', projectId: P, name: 'X', color: '#000',
      daysOff: [{ date: '2026-06-08' }], // Monday full off
    }
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: 'm1', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-05', dueDate: '2026-06-05', // Friday
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 2, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    const memberById = new Map([[member.id, member]])
    // Fri + 1 = Sat → next biz = Mon 06-08, but Mon is off → Tue 06-09
    // effort 2 → 06-09, 06-10
    expect(computeStartEnd(a, byId, memberById)).toEqual({
      startDate: '2026-06-09', dueDate: '2026-06-10',
    })
  })

  it('setMemberDaysOff recomputes tasks owned by that member', async () => {
    await db.members.add({
      id: 'm1', projectId: P, name: 'X', color: '#000', daysOff: [],
    })
    await db.tasks.bulkAdd([
      {
        id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: 'm1', sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: '2026-06-05', dueDate: '2026-06-05', // Fri
        estimate: 1, createdAt: 0, dependsOn: [],
      },
      {
        id: 'a', projectId: P, sequence: 2, title: 'a', assigneeId: 'm1', sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null,
        estimate: 2, createdAt: 1, dependsOn: ['p'],
      },
    ])
    // Trigger initial recompute by setting empty daysOff
    await setMemberDaysOff('m1', [])
    let a = await db.tasks.get('a')
    expect(a?.startDate).toBe('2026-06-08') // Mon
    expect(a?.dueDate).toBe('2026-06-09')   // Tue

    // Now mark Monday off
    await setMemberDaysOff('m1', [{ date: '2026-06-08' }])
    a = await db.tasks.get('a')
    expect(a?.startDate).toBe('2026-06-09') // Tue
    expect(a?.dueDate).toBe('2026-06-10')   // Wed
  })

  it('half-day off: effort 1 day starting on a half-off day spans 2 days', () => {
    // Mon AM-off → Mon contributes 0.5, Tue contributes 1
    const member: Member = {
      id: 'm', projectId: P, name: 'X', color: '#000',
      daysOff: [{ date: '2026-06-08', half: 'am' }],
    }
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-05', dueDate: '2026-06-05', // Fri
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 1, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    const memberById = new Map([[member.id, member]])
    // Start = Mon 06-08 (half-off still works in PM). effort 1.0
    // Mon contributes 0.5, remaining 0.5. Tue contributes 1, exits → end Tue.
    expect(computeStartEnd(a, byId, memberById)).toEqual({
      startDate: '2026-06-08', dueDate: '2026-06-09',
    })
  })

  it('half-day off: decimal effort fits within a single half-day', () => {
    const member: Member = {
      id: 'm', projectId: P, name: 'X', color: '#000',
      daysOff: [{ date: '2026-06-08', half: 'pm' }],
    }
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-05', dueDate: '2026-06-05',
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    // 0.5d task starting Mon (PM-off) → Mon contributes 0.5, fits exactly
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 0.5, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    const memberById = new Map([[member.id, member]])
    expect(computeStartEnd(a, byId, memberById)).toEqual({
      startDate: '2026-06-08', dueDate: '2026-06-08',
    })
  })

  it('half-day off: decimal effort 1.5d crosses 2 days normally', () => {
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-05', dueDate: '2026-06-05', // Fri
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 1.5, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    // Start Mon 06-08 (1.0), remaining 0.5. Tue 06-09 (1.0), exit → end Tue
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-08', dueDate: '2026-06-09',
    })
  })

  it('standalone task, start Thu 06-04, effort 2.5, half-off Fri 06-05 → end Mon 06-08', () => {
    // 2.5d effort, start Thu 2026-06-04, member half-day off on Fri 2026-06-05:
    // Thu(1.0)+Fri(0.5)+[Sat/Sun skip]+Mon(1.0) = end Mon 06-08, not Tue 06-09.
    const member: Member = {
      id: 'm', projectId: P, name: 'T', color: '#000',
      daysOff: [{ date: '2026-06-05', half: 'am' }],
    }
    const t: Task = {
      id: 'a', projectId: P, sequence: 3, title: 'phân tích bida', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-04', dueDate: null,
      estimate: 2.5, createdAt: 0, dependsOn: [],
    }
    const byId = new Map([[t.id, t]])
    const memberById = new Map([[member.id, member]])
    expect(computeStartEnd(t, byId, memberById)).toEqual({
      startDate: '2026-06-04', dueDate: '2026-06-08',
    })
    expect(computeWorkingTimes(t, byId, memberById).endTime).toBe('17:00')
  })

  it('computeWorkingPlan ignores a STALE stored dueDate — date + time come from one live plan', () => {
    // The reported bug: task's stored dueDate drifted to 06-09 (computed under
    // an older off-day state), but the member now has only a half-day off on
    // Fri 06-05. The live plan must say 06-08 17:00 — not the stale 06-09.
    const member: Member = {
      id: 'm', projectId: P, name: 'T', color: '#000',
      daysOff: [{ date: '2026-06-05', half: 'am' }],
    }
    const task: Task = {
      id: 'a', projectId: P, sequence: 3, title: 'phân tích bida', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-04', dueDate: '2026-06-09', // <-- STALE stored value
      estimate: 2.5, createdAt: 0, dependsOn: [],
    }
    const byId = new Map([[task.id, task]])
    const memberById = new Map([[member.id, member]])
    const plan = computeWorkingPlan(task, byId, memberById)
    expect(plan.startDate).toBe('2026-06-04')
    expect(plan.startTime).toBe('08:00')
    expect(plan.dueDate).toBe('2026-06-08') // not the stale 06-09
    expect(plan.endTime).toBe('17:00')
  })

  it('effort-change flow: half-off Fri 06-05, recompute stores 06-08 / 06-09 / 06-08 for effort 2 / 3 / 2.5', async () => {
    await db.members.add({
      id: 'm', projectId: P, name: 'T', color: '#000',
      daysOff: [{ date: '2026-06-05', half: 'am' }],
    })
    await db.tasks.add({
      id: 'a', projectId: P, sequence: 3, title: 'x', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-04', dueDate: null, estimate: null, createdAt: 0, dependsOn: [],
    })
    await db.tasks.update('a', { estimate: 2 }); await recomputeDates('a')
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-08') // effort 2 → 12:00 (user: correct)
    await db.tasks.update('a', { estimate: 3 }); await recomputeDates('a')
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-09') // effort 3 → 12:00 (user: correct)
    await db.tasks.update('a', { estimate: 2.5 }); await recomputeDates('a')
    // The reported-wrong case: with effort 2.5 it must store 06-08 (17:00), NOT 06-09.
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-08')
  })

  it('recomputeAllDates heals a stale stored dueDate and returns the count', async () => {
    await db.members.add({
      id: 'm', projectId: P, name: 'T', color: '#000',
      daysOff: [{ date: '2026-06-05', half: 'am' }],
    })
    // Stored dueDate is stale at 06-09; correct value for half-off 06-05 is 06-08.
    await db.tasks.add({
      id: 'a', projectId: P, sequence: 3, title: 'phân tích bida', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-04', dueDate: '2026-06-09', estimate: 2.5, createdAt: 0, dependsOn: [],
    })
    const healed = await recomputeAllDates()
    expect(healed).toBe(1)
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-08')
    // Idempotent: a second pass changes nothing.
    expect(await recomputeAllDates()).toBe(0)
  })

  it('STORED-PATH REPRO: set half-off via setMemberDaysOff → stored dueDate updates to 06-08', async () => {
    await db.members.add({ id: 'm', projectId: P, name: 'T', color: '#000', daysOff: [] })
    await db.tasks.add({
      id: 'a', projectId: P, sequence: 3, title: 'phân tích bida', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-04', dueDate: null, estimate: 2.5, createdAt: 0, dependsOn: [],
    })
    // Simulate the real edit sequence: first a FULL-day off (stores 06-09)...
    await setMemberDaysOff('m', [{ date: '2026-06-05' }])
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-09')
    // ...then change it to a half-day off. Stored dueDate MUST move to 06-08.
    await setMemberDaysOff('m', [{ date: '2026-06-05', half: 'am' }])
    expect((await db.tasks.get('a'))?.dueDate).toBe('2026-06-08')
  })

  it('computeStartEnd: effort spans weekend → end pushed past Sat/Sun', () => {
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-03', dueDate: '2026-06-03', // Wednesday
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    // a: 4 days, starts Thursday 06-04 → Thu, Fri, Mon, Tue → ends Tue 06-09
    const a: Task = { ...p, id: 'a', projectId: P, sequence: 2, estimate: 4, dependsOn: ['p'] }
    const byId = new Map([[p.id, p], [a.id, a]])
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-04', dueDate: '2026-06-09',
    })
  })

  it('computeStartEnd: no prereqs → returns existing dates', () => {
    const t: Task = {
      id: 'a', projectId: P, sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
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
      id: 'p1', projectId: P, sequence: 1, title: 'p1', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-01',
      estimate: 1, createdAt: 0, dependsOn: [],
    }
    // estimate = 3 so prereq's own walk produces dueDate 06-03 consistently.
    const p2: Task = { ...p1, id: 'p2', projectId: P, sequence: 2, estimate: 3, dueDate: '2026-06-03' }
    const a: Task = {
      id: 'a', projectId: P, sequence: 3, title: 'a', assigneeId: null, sprintId: 's',
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

  it('computeStartEnd: no effort → start computed from prereq, end stays manual', () => {
    const p: Task = {
      id: 'p', projectId: P, sequence: 1, title: 'p', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-01',
      estimate: null, createdAt: 0, dependsOn: [],
    }
    // a has prereq + manual dueDate, no effort → start is computed but
    // end is left as user set it (manual).
    const a: Task = {
      ...p, id: 'a', projectId: P, sequence: 2, estimate: null, dependsOn: ['p'],
      startDate: null, dueDate: '2026-06-10',
    }
    const byId = new Map([[p.id, p], [a.id, a]])
    expect(computeStartEnd(a, byId)).toEqual({
      startDate: '2026-06-02', dueDate: '2026-06-10',
    })
  })

  it('computeStartEnd: no prereqs but effort set → end derived from start + effort', () => {
    // start = Mon 06-01, effort = 3 → end = Wed 06-03 (skip nothing)
    const t: Task = {
      id: 't', projectId: P, sequence: 1, title: 't', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: null, estimate: 3,
      createdAt: 0, dependsOn: [],
    }
    expect(computeStartEnd(t, new Map([[t.id, t]]))).toEqual({
      startDate: '2026-06-01', dueDate: '2026-06-03',
    })
  })

  it('computeStartEnd: no prereqs, no effort → unchanged', () => {
    const t: Task = {
      id: 't', projectId: P, sequence: 1, title: 't', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: '2026-06-15', estimate: null,
      createdAt: 0, dependsOn: [],
    }
    expect(computeStartEnd(t, new Map([[t.id, t]]))).toEqual({
      startDate: '2026-06-01', dueDate: '2026-06-15',
    })
  })

  it('dependent starts same day when prereq ends mid-day', () => {
    // A: 1.5d starting Wed 06-03 → ends Thu 06-04 noon. dueFraction = 0.5.
    // B: 1d depending on A → should start Thu 13:00, end Fri 12:00.
    const a: Task = {
      id: 'a', projectId: P, sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-03', dueDate: null, estimate: 1.5,
      createdAt: 0, dependsOn: [],
    }
    const b: Task = {
      id: 'b', projectId: P, sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: null, dueDate: null, estimate: 1,
      createdAt: 1, dependsOn: ['a'],
    }
    const byId = new Map([[a.id, a], [b.id, b]])
    expect(computeStartEnd(b, byId)).toEqual({
      startDate: '2026-06-04', dueDate: '2026-06-05',
    })
    // Times: B starts PM, ends mid-day Fri.
    expect(computeWorkingTimes(b, byId)).toEqual({
      startTime: '13:00', endTime: '12:00',
    })
  })

  it('dependent skips to next day when prereq fills its day', () => {
    // A: 1d Wed → ends Wed 17:00. dueFraction = 1.
    // B: 1d depending on A → should start Thu 08:00.
    const a: Task = {
      id: 'a', projectId: P, sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-03', dueDate: null, estimate: 1,
      createdAt: 0, dependsOn: [],
    }
    const b: Task = {
      id: 'b', projectId: P, sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: null, dueDate: null, estimate: 1,
      createdAt: 1, dependsOn: ['a'],
    }
    const byId = new Map([[a.id, a], [b.id, b]])
    expect(computeStartEnd(b, byId)).toEqual({
      startDate: '2026-06-04', dueDate: '2026-06-04',
    })
    expect(computeWorkingTimes(b, byId)).toEqual({
      startTime: '08:00', endTime: '17:00',
    })
  })

  it('adding member day-off shifts a no-prereq task with effort set', async () => {
    // The new behavior the user asked for: off-days affect ALL of the
    // member's tasks with effort, not only ones with prereqs.
    await db.members.add({ id: 'm', projectId: P, name: 'X', color: '#000', daysOff: [] })
    await db.tasks.add({
      id: 't', projectId: P, sequence: 1, title: 't', assigneeId: 'm', sprintId: 's',
      status: 'todo', priority: 'normal',
      startDate: '2026-06-01', dueDate: null, estimate: 3,
      createdAt: 0, dependsOn: [],
    })
    // Initial: Mon 06-01, effort 3 → end Wed 06-03
    await setMemberDaysOff('m', [])
    let t = await db.tasks.get('t')
    expect(t?.startDate).toBe('2026-06-01')
    expect(t?.dueDate).toBe('2026-06-03')

    // Add Tuesday 06-02 off → end shifts to Thu 06-04
    await setMemberDaysOff('m', [{ date: '2026-06-02' }])
    t = await db.tasks.get('t')
    expect(t?.startDate).toBe('2026-06-01')
    expect(t?.dueDate).toBe('2026-06-04')
  })

  it('setDependencies recomputes dates and cascades forward', async () => {
    // Three tasks: a (1d, due 2026-06-01), b (2d, no deps), c (1d, depends on b)
    await db.tasks.bulkAdd([
      {
        id: 'a', projectId: P, sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: '2026-06-01', dueDate: '2026-06-01',
        estimate: 1, createdAt: 0, dependsOn: [],
      },
      {
        id: 'b', projectId: P, sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null,
        estimate: 2, createdAt: 1, dependsOn: [],
      },
      {
        id: 'c', projectId: P, sequence: 3, title: 'c', assigneeId: null, sprintId: 's',
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
        id: 'a', projectId: P, sequence: 1, title: 'a', assigneeId: null, sprintId: 's',
        status: 'todo', priority: 'normal',
        startDate: null, dueDate: null, estimate: 1, createdAt: 0,
        dependsOn: ['b'],
      },
      {
        id: 'b', projectId: P, sequence: 2, title: 'b', assigneeId: null, sprintId: 's',
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

describe('projects', () => {
  it('createProject adds a row', async () => {
    const p = await createProject('Side Project')
    expect(p.id).toBeTruthy()
    expect(p.name).toBe('Side Project')
    expect(await db.projects.count()).toBe(2) // P + Side Project
  })

  it('nextSequence is per-sprint', async () => {
    const mk = (id: string, sid: string, seq: number) =>
      db.tasks.add({
        id, projectId: P, sequence: seq, title: id,
        assigneeId: null, sprintId: sid,
        status: 'todo' as const, priority: 'normal' as const,
        startDate: null, dueDate: null, estimate: null,
        createdAt: 0, dependsOn: [],
      })
    await mk('a1', 's1', 1)
    await mk('a2', 's1', 2)
    await mk('b1', 's2', 1)
    expect(await nextSequence('s1')).toBe(3)
    expect(await nextSequence('s2')).toBe(2)
  })

  it('updateProject patches name, description, and color', async () => {
    const p = await createProject('Before')
    await updateProject(p.id, {
      name: 'After',
      description: 'A side thing',
      color: '#3b82f6',
    })
    const row = await db.projects.get(p.id)
    expect(row?.name).toBe('After')
    expect(row?.description).toBe('A side thing')
    expect(row?.color).toBe('#3b82f6')
    // Partial patches leave other fields intact.
    await updateProject(p.id, { color: '#ef4444' })
    const row2 = await db.projects.get(p.id)
    expect(row2?.name).toBe('After')
    expect(row2?.description).toBe('A side thing')
    expect(row2?.color).toBe('#ef4444')
  })

  it('deleteProject cascades members + sprints + tasks', async () => {
    await db.projects.add({ id: 'pX', name: 'X', createdAt: 0 })
    await db.members.add({ id: 'mX', projectId: 'pX', name: 'M', color: '#000', daysOff: [] })
    await db.sprints.add({ id: 'sX', projectId: 'pX', name: 'S', startDate: '2026-06-01', endDate: '2026-06-14' })
    await db.tasks.add({
      id: 'tX', projectId: 'pX', sequence: 1, title: 't',
      assigneeId: 'mX', sprintId: 'sX',
      status: 'todo', priority: 'normal',
      startDate: null, dueDate: null, estimate: null, createdAt: 0, dependsOn: [],
    })

    await deleteProject('pX')
    expect(await db.projects.get('pX')).toBeUndefined()
    expect(await db.members.get('mX')).toBeUndefined()
    expect(await db.sprints.get('sX')).toBeUndefined()
    expect(await db.tasks.get('tX')).toBeUndefined()
  })
})

describe('moveUnfinishedToNextSprint', () => {
  it('moves only not-done tasks to the next sprint', async () => {
    const s1 = { id: 's1', projectId: P, name: 'A', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s2 = { id: 's2', projectId: P, name: 'B', startDate: '2026-06-15', endDate: '2026-06-28' }
    await db.sprints.bulkAdd([s1, s2])
    const mk = (id: string, sprintId: string, status: Task['status']): Task => ({
      id, projectId: P, sequence: id.charCodeAt(0), title: id, assigneeId: null, sprintId,
      status, priority: 'normal',
      startDate: '2026-06-01', dueDate: null, estimate: null, createdAt: 0,
      dependsOn: [],
    })
    await db.tasks.bulkAdd([
      mk('a', s1.id, 'todo'),
      mk('b', s1.id, 'in_progress'),
      mk('c', s1.id, 'done'),
    ])
    const result = await moveUnfinishedToNextSprint(s1.id)
    expect(result).toEqual({ movedCount: 2, targetSprintId: s2.id })
    expect((await db.tasks.get('a'))?.sprintId).toBe(s2.id)
    expect((await db.tasks.get('b'))?.sprintId).toBe(s2.id)
    expect((await db.tasks.get('c'))?.sprintId).toBe(s1.id) // done stays
  })

  it('bumps stale start dates up to the target sprint start', async () => {
    const s1 = { id: 's1', projectId: P, name: 'A', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s2 = { id: 's2', projectId: P, name: 'B', startDate: '2026-06-15', endDate: '2026-06-28' }
    await db.sprints.bulkAdd([s1, s2])
    await db.tasks.add({
      id: 't', projectId: P, sequence: 1, title: 't', assigneeId: null, sprintId: s1.id,
      status: 'todo', priority: 'normal',
      startDate: '2026-06-02', dueDate: null, estimate: null, createdAt: 0,
      dependsOn: [],
    })
    await moveUnfinishedToNextSprint(s1.id)
    const t = await db.tasks.get('t')
    expect(t?.startDate).toBe('2026-06-15') // bumped to s2.startDate
  })

  it('returns null target when there is no next sprint', async () => {
    await db.sprints.add({
      id: 'only', projectId: P, name: 'Only', startDate: '2026-06-01', endDate: '2026-06-14',
    })
    const result = await moveUnfinishedToNextSprint('only')
    expect(result).toEqual({ movedCount: 0, targetSprintId: null })
  })

  it('renumbers moved tasks so sequences stay unique in the target sprint', async () => {
    const s1 = { id: 's1', projectId: P, name: 'A', startDate: '2026-06-01', endDate: '2026-06-14' }
    const s2 = { id: 's2', projectId: P, name: 'B', startDate: '2026-06-15', endDate: '2026-06-28' }
    await db.sprints.bulkAdd([s1, s2])
    const mk = (id: string, sprintId: string, sequence: number, status: Task['status']): Task => ({
      id, projectId: P, sequence, title: id, assigneeId: null, sprintId,
      status, priority: 'normal',
      startDate: '2026-06-01', dueDate: null, estimate: null, createdAt: 0, dependsOn: [],
    })
    // Target sprint already owns sequences 1 and 2; the unfinished source tasks
    // are ALSO numbered 1 and 2 — moving them must renumber, not collide.
    await db.tasks.bulkAdd([
      mk('x', s2.id, 1, 'todo'),
      mk('y', s2.id, 2, 'todo'),
      mk('a', s1.id, 1, 'todo'),
      mk('b', s1.id, 2, 'in_progress'),
    ])
    await moveUnfinishedToNextSprint(s1.id)
    const inS2 = await db.tasks.where('sprintId').equals(s2.id).toArray()
    const seqs = inS2.map((t) => t.sequence).sort((m, n) => m - n)
    expect(inS2).toHaveLength(4)
    expect(new Set(seqs).size).toBe(4) // all unique — no collision
    expect(seqs).toEqual([1, 2, 3, 4]) // moved tasks appended after existing max
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
      members: [{ id: 'm1', projectId: P, name: 'X', color: '#000000' }],
      sprints: [
        { id: 's1', projectId: P, name: 'Old Sprint', startDate: '2026-05-01', endDate: '2026-05-14' },
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
