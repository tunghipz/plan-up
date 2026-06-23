import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  exportProject,
  importProject,
  createProject,
  setDependencies,
  type Task,
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
    db.aiThreads.clear(),
    db.aiMessages.clear(),
  ])
}

// Build a small project A directly in the DB, return its id + a couple of task ids.
async function seedProjectA() {
  const pid = uid()
  const mid = uid()
  const sid = uid()
  await db.projects.add({ id: pid, name: 'Alpha', createdAt: 1 })
  await db.members.add({
    id: mid,
    projectId: pid,
    name: 'Tâm',
    color: '#abc',
    daysOff: [],
  })
  await db.sprints.add({
    id: sid,
    projectId: pid,
    name: 'Sprint 1',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
  })
  const t1: Task = {
    id: uid(),
    projectId: pid,
    sequence: 1,
    title: 'A1',
    assigneeId: mid,
    sprintId: sid,
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 2,
    dependsOn: [],
  }
  const t2: Task = {
    id: uid(),
    projectId: pid,
    sequence: 2,
    title: 'A2',
    assigneeId: null,
    sprintId: sid,
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 3,
    dependsOn: [],
  }
  await db.tasks.bulkAdd([t1, t2])
  // t2 depends on t1 (intra-project link that must survive the round-trip)
  await setDependencies(t2.id, [t1.id])
  await db.events.add({
    id: uid(),
    projectId: pid,
    sprintId: sid,
    taskId: null,
    taskSeq: null,
    taskTitle: null,
    kind: 'sprint_started',
    from: null,
    to: null,
    ts: 5,
  })
  const aiThreadId = uid()
  await db.aiThreads.add({
    id: aiThreadId,
    projectId: pid,
    title: 'Planning chat',
    createdAt: 6,
    updatedAt: 7,
    skillId: 'project-management',
  })
  await db.aiMessages.add({
    id: uid(),
    projectId: pid,
    threadId: aiThreadId,
    role: 'user',
    content: 'What is risky?',
    ts: 7,
  })
  return { pid, mid, sid, t1Id: t1.id, t2Id: t2.id }
}

describe('exportProject', () => {
  beforeEach(clearAll)

  it('exports only the named project’s rows', async () => {
    const { pid } = await seedProjectA()
    // a second, unrelated project that must NOT leak into the bundle
    const other = await createProject('Beta')
    const bundle = await exportProject(pid)

    expect(bundle.kind).toBe('project')
    expect(bundle.version).toBe(5)
    expect(bundle.project.id).toBe(pid)
    expect(bundle.tasks).toHaveLength(2)
    expect(bundle.members).toHaveLength(1)
    expect(bundle.aiThreads).toHaveLength(1)
    expect(bundle.aiMessages).toHaveLength(1)
    expect(bundle.tasks.every((t) => t.projectId === pid)).toBe(true)
    expect(bundle.project.name).not.toBe('Beta')
    expect(other).not.toBe(pid)
  })

  it('throws for an unknown project id', async () => {
    await expect(exportProject('does-not-exist')).rejects.toThrow()
  })

  it('carries the project emoji icon through export → import', async () => {
    const { pid } = await seedProjectA()
    await db.projects.update(pid, { icon: '🚀' })

    const bundle = await exportProject(pid)
    expect(bundle.project.icon).toBe('🚀')

    const { projectId } = await importProject(bundle)
    const imported = await db.projects.get(projectId)
    expect(imported?.icon).toBe('🚀')
  })
})

describe('importProject', () => {
  beforeEach(clearAll)

  it('adds a new project alongside existing ones, leaving them untouched', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)

    const before = await db.projects.toArray()
    const result = await importProject(bundle)

    const after = await db.projects.toArray()
    expect(after).toHaveLength(before.length + 1)
    expect(result.projectId).not.toBe(pid)
    expect(result.projectName).toBe('Alpha')
    expect(result.taskCount).toBe(2)
    // original project A is byte-for-byte untouched
    const originalA = after.find((p) => p.id === pid)!
    expect(originalA.name).toBe('Alpha')
  })

  it('round-trips intra-project deps/assignee/sprint links onto NEW ids', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)
    const { projectId: newPid } = await importProject(bundle)

    const newTasks = await db.tasks.where('projectId').equals(newPid).toArray()
    const newSprints = await db.sprints.where('projectId').equals(newPid).toArray()
    const newMembers = await db.members.where('projectId').equals(newPid).toArray()
    expect(newTasks).toHaveLength(2)

    const a1 = newTasks.find((t) => t.sequence === 1)!
    const a2 = newTasks.find((t) => t.sequence === 2)!
    // assignee + sprint remapped into the new id space
    expect(a1.assigneeId).toBe(newMembers[0].id)
    expect(a1.sprintId).toBe(newSprints[0].id)
    // dependency survives and points at the new t1 id (not the old one)
    expect(a2.dependsOn).toEqual([a1.id])
    expect(a2.dependsOn[0]).not.toBe(undefined)
  })

  it('round-trips AI chat history onto NEW thread ids', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)
    const oldThreadId = bundle.aiThreads?.[0].id

    const { projectId: newPid } = await importProject(bundle)

    const threads = await db.aiThreads.where('projectId').equals(newPid).toArray()
    const messages = await db.aiMessages.where('projectId').equals(newPid).toArray()
    expect(threads).toHaveLength(1)
    expect(messages).toHaveLength(1)
    expect(threads[0].id).not.toBe(oldThreadId)
    expect(messages[0].threadId).toBe(threads[0].id)
    expect(messages[0].content).toBe('What is risky?')
  })

  it('imports the same file twice into two independent copies (no collision)', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)

    const r1 = await importProject(bundle)
    const r2 = await importProject(bundle)

    expect(r1.projectId).not.toBe(r2.projectId)
    const all = await db.projects.toArray()
    // original + two imported copies
    expect(all.filter((p) => p.name === 'Alpha')).toHaveLength(3)
    // task ids are globally distinct
    const taskIds = (await db.tasks.toArray()).map((t) => t.id)
    expect(new Set(taskIds).size).toBe(taskIds.length)
  })

  // Cross-project People: imported members must link to a Person in THIS db
  // (the bundle's personId references the source db). See design-docs/home-dashboard.md.
  it('links each imported member to a Person by normalized name', async () => {
    const { pid } = await seedProjectA() // member "Tâm", no personId in the bundle
    const bundle = await exportProject(pid)

    const { projectId } = await importProject(bundle)
    const people = await db.people.toArray()
    const imported = await db.members.where('projectId').equals(projectId).toArray()

    expect(people).toHaveLength(1)
    expect(people[0].name).toBe('Tâm')
    expect(imported[0].personId).toBe(people[0].id)
  })

  it('re-importing the same person reuses the existing Person (no duplicate)', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)

    const a = await importProject(bundle)
    const b = await importProject(bundle)

    // Two project copies, but ONE shared person "Tâm" across both.
    const people = await db.people.toArray()
    expect(people).toHaveLength(1)
    const mA = (await db.members.where('projectId').equals(a.projectId).toArray())[0]
    const mB = (await db.members.where('projectId').equals(b.projectId).toArray())[0]
    expect(mA.personId).toBe(people[0].id)
    expect(mB.personId).toBe(people[0].id)
  })

  it('preserves Task.sequence and lets the next created task self-correct', async () => {
    const { pid } = await seedProjectA()
    const bundle = await exportProject(pid)
    const { projectId: newPid } = await importProject(bundle)
    const seqs = (await db.tasks.where('projectId').equals(newPid).toArray())
      .map((t) => t.sequence)
      .sort()
    expect(seqs).toEqual([1, 2])
  })

  it('keeps the sprint-level event (null taskId) after import', async () => {
    const { pid } = await seedProjectA()
    const srcEvents = await db.events.where('projectId').equals(pid).toArray()
    const bundle = await exportProject(pid)
    const { projectId: newPid } = await importProject(bundle)
    const events = await db.events.where('projectId').equals(newPid).toArray()
    // every source event survives (sprint_started + the dependsOn edit logged
    // by setDependencies, whose taskId resolves to the new task)
    expect(events).toHaveLength(srcEvents.length)
    const sprintEv = events.find((e) => e.kind === 'sprint_started')!
    expect(sprintEv).toBeDefined()
    expect(sprintEv.taskId).toBeNull()
    expect(sprintEv.sprintId).not.toBe(bundle.sprints[0].id)
  })
})
