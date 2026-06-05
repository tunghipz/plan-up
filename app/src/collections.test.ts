import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'

async function clearAll() {
  await db.transaction('rw', db.projects, db.members, db.sprints, db.tasks, db.collections, async () => {
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
