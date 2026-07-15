import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, it, expect } from 'vitest'
import { PlanDB } from './schema'

// The v1→v13 upgrade chain is the riskiest code in the data layer and used to
// be tested only via its extracted pure functions. These tests seed a REAL
// old-shape database (fake-indexeddb), then open it with the production PlanDB
// class so every upgrade callback actually runs through Dexie's version chain.

let dbSeq = 0
const freshName = () => `plan-up-migration-test-${++dbSeq}`

/**
 * Seed a v1-era database: members/sprints/tasks only, and rows shaped the way
 * the app wrote them back then — tasks without startDate/dependsOn/sequence/
 * projectId/collectionId, members with daysOff as plain strings (pre-v6) and
 * no projectId/order/personId, plus a dead `changeLog` field (removed in v11).
 */
async function seedV1(name: string) {
  const old = new Dexie(name)
  old.version(1).stores({
    members: 'id, name',
    sprints: 'id, startDate',
    tasks: 'id, sprintId, assigneeId, status, createdAt',
  })
  await old.open()
  await old.table('members').bulkAdd([
    // Two spellings of the same normalized name → ONE person after v13.
    { id: 'm-bob-1', name: 'Bob', color: '#111111', daysOff: ['2026-06-05'] },
    { id: 'm-bob-2', name: 'bob ', color: '#222222' }, // no daysOff at all (pre-v5)
    { id: 'm-ann', name: 'Ann', color: '#333333', daysOff: [] },
  ])
  await old.table('sprints').bulkAdd([
    { id: 's1', name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' },
    { id: 's2', name: 'Sprint 2', startDate: '2026-06-15', endDate: '2026-06-28' },
  ])
  await old.table('tasks').bulkAdd([
    // createdAt deliberately out of insertion order — v4/v8 renumber by createdAt.
    { id: 't-s1-b', sprintId: 's1', assigneeId: 'm-ann', status: 'todo', priority: 'normal', title: 'B', createdAt: 20, changeLog: [{ field: 'title' }] },
    { id: 't-s1-a', sprintId: 's1', assigneeId: null, status: 'done', priority: 'high', title: 'A', createdAt: 10 },
    { id: 't-s2-x', sprintId: 's2', assigneeId: 'm-bob-1', status: 'todo', priority: 'normal', title: 'X', createdAt: 30 },
  ])
  old.close()
}

describe('v1 → v14 migration chain (through Dexie, not the extracted fns)', () => {
  it('upgrades a v1 database end-to-end', async () => {
    const name = freshName()
    await seedV1(name)

    const db = new PlanDB(name)
    await db.open()
    expect(db.verno).toBe(14)

    const tasks = await db.tasks.toArray()
    const byId = new Map(tasks.map((t) => [t.id, t]))

    // v2/v3: startDate null + dependsOn [] backfilled.
    for (const t of tasks) {
      expect(t.startDate).toBeNull()
      expect(t.dependsOn).toEqual([])
      // v9: collectionId backfilled to null.
      expect(t.collectionId).toBeNull()
    }

    // v4 then v8: sequence is per-SPRINT in createdAt order, restarting at 1.
    expect(byId.get('t-s1-a')!.sequence).toBe(1)
    expect(byId.get('t-s1-b')!.sequence).toBe(2)
    expect(byId.get('t-s2-x')!.sequence).toBe(1)

    // v11: the dead changeLog field is stripped from stored rows.
    expect(
      'changeLog' in (byId.get('t-s1-b') as unknown as Record<string, unknown>)
    ).toBe(false)

    // v5/v6: daysOff exists everywhere and strings became {date} objects.
    const members = await db.members.toArray()
    const mBob1 = members.find((m) => m.id === 'm-bob-1')!
    const mBob2 = members.find((m) => m.id === 'm-bob-2')!
    expect(mBob1.daysOff).toEqual([{ date: '2026-06-05' }])
    expect(mBob2.daysOff).toEqual([])

    // v7: a default project was synthesized and stamped onto every row.
    const projects = await db.projects.toArray()
    expect(projects).toHaveLength(1)
    const pid = projects[0].id
    for (const m of members) expect(m.projectId).toBe(pid)
    for (const t of tasks) expect(t.projectId).toBe(pid)
    for (const s of await db.sprints.toArray()) expect(s.projectId).toBe(pid)

    // v12: manual lane order backfilled 0..N-1 within the project.
    expect(new Set(members.map((m) => m.order)).size).toBe(members.length)
    for (const m of members) {
      expect(m.order).toBeGreaterThanOrEqual(0)
      expect(m.order).toBeLessThan(members.length)
    }

    // v13: people backfilled — "Bob" and "bob " unify, Ann is separate, and
    // every member carries a personId that resolves.
    const people = await db.people.toArray()
    expect(people).toHaveLength(2)
    expect(mBob1.personId).toBeTruthy()
    expect(mBob1.personId).toBe(mBob2.personId)
    const mAnn = members.find((m) => m.id === 'm-ann')!
    expect(mAnn.personId).toBeTruthy()
    expect(mAnn.personId).not.toBe(mBob1.personId)
    const peopleIds = new Set(people.map((p) => p.id))
    for (const m of members) expect(peopleIds.has(m.personId!)).toBe(true)

    await db.delete()
  })

  it('re-opening an already-migrated database is a no-op (idempotent open)', async () => {
    const name = freshName()
    await seedV1(name)

    const first = new PlanDB(name)
    await first.open()
    const tasksBefore = (await first.tasks.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    const peopleBefore = (await first.people.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    first.close()

    const second = new PlanDB(name)
    await second.open()
    const tasksAfter = (await second.tasks.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    const peopleAfter = (await second.people.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id)
    )
    expect(tasksAfter).toEqual(tasksBefore)
    // No duplicate people on re-open (the v13 backfill must not run twice).
    expect(peopleAfter).toEqual(peopleBefore)

    await second.delete()
  })

  it('a mid-chain (v7-era) database upgrades too — per-project renumber + people', async () => {
    const name = freshName()
    const old = new Dexie(name)
    // Exactly the v7 stores block from schema.ts.
    old.version(7).stores({
      projects: 'id, name, createdAt',
      members: 'id, name, projectId',
      sprints: 'id, startDate, projectId',
      tasks: 'id, sprintId, assigneeId, status, createdAt, projectId',
    })
    await old.open()
    await old.table('projects').add({ id: 'p1', name: 'Alpha', createdAt: 1 })
    await old.table('members').add({
      id: 'm1',
      projectId: 'p1',
      name: 'Chi',
      color: '#444444',
      daysOff: [],
    })
    await old.table('sprints').bulkAdd([
      { id: 's1', projectId: 'p1', name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' },
      { id: 's2', projectId: 'p1', name: 'Sprint 2', startDate: '2026-06-15', endDate: '2026-06-28' },
    ])
    // Per-PROJECT sequences (the pre-v8 scheme): 1..3 across two sprints.
    await old.table('tasks').bulkAdd([
      { id: 't1', projectId: 'p1', sprintId: 's1', assigneeId: null, status: 'todo', priority: 'normal', title: 'a', createdAt: 1, sequence: 1, startDate: null, dependsOn: [] },
      { id: 't2', projectId: 'p1', sprintId: 's2', assigneeId: null, status: 'todo', priority: 'normal', title: 'b', createdAt: 2, sequence: 2, startDate: null, dependsOn: [] },
      { id: 't3', projectId: 'p1', sprintId: 's2', assigneeId: null, status: 'todo', priority: 'normal', title: 'c', createdAt: 3, sequence: 3, startDate: null, dependsOn: [] },
    ])
    old.close()

    const db = new PlanDB(name)
    await db.open()

    // v8 renumbered per sprint: s1 → [1], s2 → [1, 2].
    const tasks = await db.tasks.toArray()
    const seqs = (sid: string) =>
      tasks
        .filter((t) => t.sprintId === sid)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map((t) => t.sequence)
    expect(seqs('s1')).toEqual([1])
    expect(seqs('s2')).toEqual([1, 2])

    // The existing project is kept (no synthesized "My Project").
    const projects = await db.projects.toArray()
    expect(projects.map((p) => p.name)).toEqual(['Alpha'])

    // v13 linked the lone member to a person.
    const m = (await db.members.toArray())[0]
    expect(m.personId).toBeTruthy()
    expect(await db.people.count()).toBe(1)

    await db.delete()
  })
})
