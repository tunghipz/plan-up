import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  exportAll,
  importAll,
  deleteProject,
  addCollectionItem,
  mergePeople,
  renamePerson,
  recolorPerson,
  type ExportPayload,
  type ShareRecord,
} from './db'

async function clearAll() {
  await Promise.all([
    db.projects.clear(),
    db.members.clear(),
    db.sprints.clear(),
    db.collections.clear(),
    db.tasks.clear(),
    db.events.clear(),
    db.people.clear(),
    db.shares.clear(),
  ])
}

/** Two projects, each with a member; both members share a Person ("Bob"). */
async function seedTwoProjects() {
  const pidA = uid()
  const pidB = uid()
  const personBob = uid()
  const personRobert = uid()
  const memA = uid()
  const memB = uid()
  await db.projects.bulkAdd([
    { id: pidA, name: 'Alpha', createdAt: 1 },
    { id: pidB, name: 'Beta', createdAt: 2 },
  ])
  await db.people.bulkAdd([
    { id: personBob, name: 'Bob', color: '#111111', createdAt: 1 },
    { id: personRobert, name: 'Robert', color: '#222222', createdAt: 1 },
  ])
  await db.members.bulkAdd([
    {
      id: memA,
      projectId: pidA,
      name: 'Bob',
      color: '#111111',
      daysOff: [],
      personId: personBob,
    },
    {
      id: memB,
      projectId: pidB,
      name: 'Robert',
      color: '#222222',
      daysOff: [],
      personId: personRobert,
    },
  ])
  return { pidA, pidB, personBob, personRobert, memA, memB }
}

describe('exportAll/importAll People round-trip', () => {
  beforeEach(clearAll)

  it('exports people (payload v5)', async () => {
    await seedTwoProjects()
    const data = await exportAll()
    expect(data.version).toBe(7)
    expect(data.people).toHaveLength(2)
  })

  it('a merge survives export → import', async () => {
    const { personBob, personRobert, memA, memB } = await seedTwoProjects()
    // User merges Robert into Bob: one person, two member rows.
    await mergePeople(personRobert, personBob)
    const data = await exportAll()
    await importAll(data)

    const people = await db.people.toArray()
    expect(people).toHaveLength(1)
    expect(people[0].id).toBe(personBob)
    const a = await db.members.get(memA)
    const b = await db.members.get(memB)
    expect(a?.personId).toBe(personBob)
    expect(b?.personId).toBe(personBob)
  })

  it('a rename + recolor survives export → import', async () => {
    const { personBob } = await seedTwoProjects()
    await renamePerson(personBob, 'Bobby')
    await recolorPerson(personBob, '#ff0000')
    const data = await exportAll()
    await importAll(data)

    const p = await db.people.get(personBob)
    expect(p?.name).toBe('Bobby')
    expect(p?.color).toBe('#ff0000')
  })

  it('pre-v5 payloads (no people) still backfill from member names', async () => {
    const { memA, memB } = await seedTwoProjects()
    const data = await exportAll()
    // Simulate an old backup: strip people, downgrade version.
    const old = { ...data, version: 4, people: undefined } as ExportPayload
    await importAll(old)

    const people = await db.people.toArray()
    expect(people).toHaveLength(2) // Bob + Robert rebuilt by name
    const a = await db.members.get(memA)
    const b = await db.members.get(memB)
    expect(a?.personId).toBeTruthy()
    expect(b?.personId).toBeTruthy()
    expect(a?.personId).not.toBe(b?.personId)
  })

  it('a dangling member.personId re-links by name instead of crashing', async () => {
    await seedTwoProjects()
    const data = await exportAll()
    // Hand-edited/truncated file: drop one person row but keep the link.
    const broken: ExportPayload = {
      ...data,
      people: data.people!.filter((p) => p.name !== 'Robert'),
    }
    await importAll(broken)

    const members = await db.members.toArray()
    for (const m of members) {
      expect(m.personId).toBeTruthy()
      expect(await db.people.get(m.personId!)).toBeTruthy()
    }
  })

  it('rejects a payload whose people field is not an array', async () => {
    await seedTwoProjects()
    const data = await exportAll()
    const evil = { ...data, people: 'nope' } as unknown as ExportPayload
    await expect(importAll(evil)).rejects.toThrow('Not a valid plan-up backup')
    // Nothing was cleared.
    expect(await db.projects.count()).toBe(2)
  })
})

describe('deleteProject wipes everything the project owns', () => {
  beforeEach(clearAll)

  it('removes collections and activity events, not just tasks/sprints/members', async () => {
    const { pidA, pidB } = await seedTwoProjects()
    const sidA = uid()
    await db.sprints.add({
      id: sidA,
      projectId: pidA,
      name: 'Sprint 1',
      startDate: '2026-06-01',
      endDate: '2026-06-14',
    })
    await db.collections.bulkAdd([
      { id: uid(), projectId: pidA, name: 'Backlog', statuses: [], sections: [], order: 1, createdAt: 1 },
      { id: uid(), projectId: pidB, name: 'Ideas', statuses: [], sections: [], order: 1, createdAt: 1 },
    ])
    await db.events.bulkAdd([
      {
        id: uid(),
        projectId: pidA,
        sprintId: sidA,
        taskId: null,
        taskSeq: null,
        taskTitle: null,
        kind: 'sprint_started',
        from: null,
        to: null,
        ts: 1,
      },
    ])

    await deleteProject(pidA)

    expect(await db.projects.get(pidA)).toBeUndefined()
    expect(await db.collections.where('projectId').equals(pidA).count()).toBe(0)
    expect(await db.events.where('projectId').equals(pidA).count()).toBe(0)
    // The OTHER project's rows survive.
    expect(await db.collections.where('projectId').equals(pidB).count()).toBe(1)
  })
})

describe('exportAll/importAll shares round-trip', () => {
  beforeEach(clearAll)

  const shareRec = (over: Partial<ShareRecord> = {}): ShareRecord => ({
    id: 'abc123',
    refId: 'sprint-x',
    kind: 'sprint',
    slug: 'alpha',
    writeToken: 'tok-secret',
    url: 'https://plan-up-eta.vercel.app/view/alpha-abc123',
    lastSig: 'sig1',
    selectedIds: ['m1', 'm2'],
    createdAt: 1,
    updatedAt: 2,
    projectId: 'pA',
    ...over,
  })

  it('a hosted share (with its write token) survives export → import (v6)', async () => {
    await db.projects.add({ id: 'pA', name: 'Alpha', createdAt: 1 })
    await db.shares.add(shareRec())
    const data = await exportAll()
    expect(data.version).toBe(7)
    expect(data.shares).toHaveLength(1)

    await importAll(data)
    const got = await db.shares.get('abc123')
    expect(got?.writeToken).toBe('tok-secret')
    expect(got?.lastSig).toBe('sig1')
    expect(got?.selectedIds).toEqual(['m1', 'm2'])
  })

  it('a pre-v6 backup (no shares) imports cleanly, leaving shares empty', async () => {
    await db.projects.add({ id: 'pA', name: 'Alpha', createdAt: 1 })
    await db.shares.add(shareRec()) // a local share that must be cleared by the restore
    const data = await exportAll()
    const old = { ...data, version: 5, shares: undefined } as ExportPayload
    await importAll(old)
    expect(await db.shares.count()).toBe(0)
  })

  it('rejects a payload whose shares field is not an array', async () => {
    await db.projects.add({ id: 'pA', name: 'Alpha', createdAt: 1 })
    const data = await exportAll()
    const evil = { ...data, shares: 'nope' } as unknown as ExportPayload
    await expect(importAll(evil)).rejects.toThrow('Not a valid plan-up backup')
  })
})

describe('addCollectionItem input integrity', () => {
  beforeEach(clearAll)

  it('throws on a missing collection instead of inserting an orphan', async () => {
    await expect(
      addCollectionItem('no-such-collection', 'sec', { title: 'x' })
    ).rejects.toThrow('not found')
    expect(await db.tasks.count()).toBe(0)
  })
})
