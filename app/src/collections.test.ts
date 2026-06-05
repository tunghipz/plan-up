import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import {
  createCollection, renameCollection, deleteCollection, COLLECTION_PALETTE,
  addSection, deleteSection, moveTaskToSection,
  addStatus, renameStatus, recolorStatus, deleteStatus,
  addCollectionItem,
  exportAll, importAll,
} from './db'

async function clearAll() {
  await db.transaction('rw', [db.projects, db.members, db.sprints, db.tasks, db.collections], async () => {
    await db.tasks.clear(); await db.sprints.clear(); await db.members.clear()
    await db.collections.clear(); await db.projects.clear()
  })
}

describe('schema v9 / collections table', () => {
  beforeEach(clearAll)

  it('exposes a collections table and tasks accept collection fields', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    await db.collections.add({
      id: 'c1', projectId: 'p1', name: 'Live-ops', order: 0,
      sections: [{ id: 'sec1', name: 'All' }], statuses: [], createdAt: 1,
    })
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'x', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: '2026-06-01',
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: 'c1', sectionId: 'sec1', collectionStatusId: null,
    })
    const got = await db.tasks.where('collectionId').equals('c1').toArray()
    expect(got).toHaveLength(1)
    expect(got[0].sprintId).toBeNull()
    const c = await db.collections.get('c1')
    expect(c?.sections[0].name).toBe('All')

    // Mutual-exclusion invariant: sprint task and collection task live in separate indexes
    await db.tasks.add({
      id: 't2', projectId: 'p1', sequence: 2, title: 'sprint task', assigneeId: null,
      sprintId: 'sp1', status: 'todo', priority: 'normal', startDate: '2026-06-01',
      dueDate: null, estimate: null, createdAt: 2, dependsOn: [],
    })
    const sprintTasks = await db.tasks.where('sprintId').equals('sp1').toArray()
    expect(sprintTasks).toHaveLength(1)
    expect(sprintTasks[0].id).toBe('t2')

    const collectionTasks = await db.tasks.where('collectionId').equals('c1').toArray()
    expect(collectionTasks).toHaveLength(1)
    expect(collectionTasks[0].id).toBe('t1')
  })
})

describe('collection CRUD', () => {
  beforeEach(clearAll)

  it('createCollection seeds one "All" section + default statuses', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'Live-ops 2026')
    expect(c.name).toBe('Live-ops 2026')
    expect(c.sections).toHaveLength(1)
    expect(c.sections[0].name).toBe('All')
    expect(c.statuses.length).toBeGreaterThan(0)
    expect(COLLECTION_PALETTE).toContain(c.statuses[0].color)
  })

  it('renameCollection trims + ignores empty', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    await renameCollection(c.id, '  Roadmap  ')
    expect((await db.collections.get(c.id))?.name).toBe('Roadmap')
    await renameCollection(c.id, '   ')
    expect((await db.collections.get(c.id))?.name).toBe('Roadmap')
  })

  it('deleteCollection removes the collection AND its items', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: c.sections[0].id, collectionStatusId: null,
    })
    await deleteCollection(c.id)
    expect(await db.collections.get(c.id)).toBeUndefined()
    expect(await db.tasks.where('collectionId').equals(c.id).count()).toBe(0)
  })
})

describe('section CRUD', () => {
  beforeEach(clearAll)
  async function setup() {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    return createCollection('p1', 'X')
  }

  it('addSection appends a named table', async () => {
    const c = await setup()
    await addSection(c.id, 'Tháng 6')
    const got = await db.collections.get(c.id)
    expect(got?.sections.map((s) => s.name)).toEqual(['All', 'Tháng 6'])
  })

  it('deleteSection moves its items to the FIRST section, never removes last', async () => {
    const c = await setup()
    await addSection(c.id, 'B')
    const fresh = await db.collections.get(c.id)
    const [all, b] = fresh!.sections
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: b.id, collectionStatusId: null,
    })
    await deleteSection(c.id, b.id)
    expect((await db.collections.get(c.id))?.sections).toHaveLength(1)
    expect((await db.tasks.get('t1'))?.sectionId).toBe(all.id)
    // không xoá section cuối cùng
    await deleteSection(c.id, all.id)
    expect((await db.collections.get(c.id))?.sections).toHaveLength(1)
  })

  it('moveTaskToSection sets sectionId', async () => {
    const c = await setup()
    await addSection(c.id, 'B')
    const fresh = await db.collections.get(c.id)
    const b = fresh!.sections[1]
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: fresh!.sections[0].id, collectionStatusId: null,
    })
    await moveTaskToSection('t1', b.id)
    expect((await db.tasks.get('t1'))?.sectionId).toBe(b.id)
  })
})

describe('addCollectionItem', () => {
  beforeEach(clearAll)
  it('creates a Task with sprintId=null, default status = first, startDate=today', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'X')
    const t = await addCollectionItem(c.id, c.sections[0].id, { title: 'Đập trứng' })
    expect(t.sprintId).toBeNull()
    expect(t.collectionId).toBe(c.id)
    expect(t.sectionId).toBe(c.sections[0].id)
    expect(t.collectionStatusId).toBe(c.statuses[0].id) // status đầu tiên
    expect(t.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(t.title).toBe('Đập trứng')
    expect((await db.tasks.get(t.id))?.title).toBe('Đập trứng')
  })
})

describe('export/import collections', () => {
  beforeEach(clearAll)
  it('round-trips collections + their items', async () => {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    const c = await createCollection('p1', 'Live-ops')
    await addCollectionItem(c.id, c.sections[0].id, { title: 'Đập trứng' })
    const payload = await exportAll()
    expect(payload.version).toBe(3)
    expect(payload.collections?.length).toBe(1)
    await clearAll()
    await importAll(payload)
    expect(await db.collections.count()).toBe(1)
    expect(await db.tasks.where('collectionId').equals(c.id).count()).toBe(1)
  })

  it('still imports a v2 payload (no collections) without error', async () => {
    await importAll({
      version: 2, exportedAt: 'x',
      projects: [{ id: 'p1', name: 'P', createdAt: 1 }],
      members: [], sprints: [], tasks: [],
    })
    expect(await db.collections.count()).toBe(0)
  })
})

describe('status CRUD', () => {
  beforeEach(clearAll)
  async function setup() {
    await db.projects.add({ id: 'p1', name: 'P', createdAt: 1 })
    return createCollection('p1', 'X')
  }

  it('addStatus appends with a palette color', async () => {
    const c = await setup()
    await addStatus(c.id, 'LIVE', '#34C759')
    const got = await db.collections.get(c.id)
    expect(got?.statuses.map((s) => s.name)).toContain('LIVE')
  })

  it('recolorStatus + renameStatus mutate in place', async () => {
    const c = await setup()
    const sid = c.statuses[0].id
    await renameStatus(c.id, sid, 'SHIPPED')
    await recolorStatus(c.id, sid, '#AF52DE')
    const got = await db.collections.get(c.id)
    const s = got!.statuses.find((x) => x.id === sid)!
    expect(s.name).toBe('SHIPPED')
    expect(s.color).toBe('#AF52DE')
  })

  it('deleteStatus nulls items that used it', async () => {
    const c = await setup()
    const sid = c.statuses[0].id
    await db.tasks.add({
      id: 't1', projectId: 'p1', sequence: 1, title: 'a', assigneeId: null,
      sprintId: null, status: 'todo', priority: 'normal', startDate: null,
      dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
      collectionId: c.id, sectionId: c.sections[0].id, collectionStatusId: sid,
    })
    await deleteStatus(c.id, sid)
    expect((await db.collections.get(c.id))?.statuses.find((s) => s.id === sid)).toBeUndefined()
    expect((await db.tasks.get('t1'))?.collectionStatusId).toBeNull()
  })
})
