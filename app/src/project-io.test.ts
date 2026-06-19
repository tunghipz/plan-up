import { describe, it, expect } from 'vitest'
import { isProjectBundle, remapBundle, type ProjectBundle } from './project-io'
import type {
  Project,
  Member,
  Sprint,
  Collection,
  Task,
  ActivityEvent,
} from './db'

// ── deterministic id factory: n1, n2, n3, … (no crypto, fully repeatable) ──
function counter() {
  let n = 0
  return () => `n${++n}`
}

// A small but representative project: 1 member, 1 sprint, 1 collection
// (2 sections + 2 statuses), 3 tasks (one assigned, one in a collection table,
// one unassigned with a dependency + parent), and 3 events.
function sampleBundle(): ProjectBundle {
  const project: Project = { id: 'p1', name: 'Marketing', createdAt: 1 }
  const member: Member = {
    id: 'm1',
    projectId: 'p1',
    name: 'Tâm',
    color: '#abc',
    daysOff: [],
  }
  const sprint: Sprint = {
    id: 's1',
    projectId: 'p1',
    name: 'Sprint 1',
    startDate: '2026-06-01',
    endDate: '2026-06-14',
  }
  const collection: Collection = {
    id: 'c1',
    projectId: 'p1',
    name: 'Backlog',
    order: 1,
    sections: [
      { id: 'sec1', name: 'A' },
      { id: 'sec2', name: 'B' },
    ],
    statuses: [
      { id: 'st1', name: 'Idea', color: '#111' },
      { id: 'st2', name: 'Doing', color: '#222' },
    ],
    createdAt: 2,
  }
  const t1: Task = {
    id: 't1',
    projectId: 'p1',
    sequence: 1,
    title: 'First',
    assigneeId: 'm1',
    sprintId: 's1',
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 3,
    dependsOn: [],
  }
  const t2: Task = {
    id: 't2',
    projectId: 'p1',
    sequence: 2,
    title: 'Second (in collection)',
    assigneeId: null,
    sprintId: null,
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 4,
    dependsOn: [],
    collectionId: 'c1',
    sectionId: 'sec2',
    collectionStatusId: 'st2',
  }
  const t3: Task = {
    id: 't3',
    projectId: 'p1',
    sequence: 3,
    title: 'Third (depends on t1, child of t1)',
    assigneeId: null,
    sprintId: 's1',
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 5,
    dependsOn: ['t1'],
    parentId: 't1',
  }
  const evCreated: ActivityEvent = {
    id: 'e1',
    projectId: 'p1',
    sprintId: 's1',
    taskId: 't1',
    taskSeq: 1,
    taskTitle: 'First',
    kind: 'created',
    from: null,
    to: null,
    ts: 10,
  }
  const evSprint: ActivityEvent = {
    id: 'e2',
    projectId: 'p1',
    sprintId: 's1',
    taskId: null,
    taskSeq: null,
    taskTitle: null,
    kind: 'sprint_started',
    from: null,
    to: null,
    ts: 11,
  }
  return {
    version: 5,
    kind: 'project',
    exportedAt: '2026-06-19T00:00:00.000Z',
    project,
    members: [member],
    sprints: [sprint],
    collections: [collection],
    tasks: [t1, t2, t3],
    events: [evCreated, evSprint],
  }
}

describe('isProjectBundle', () => {
  it('accepts a well-formed project bundle', () => {
    expect(isProjectBundle(sampleBundle())).toBe(true)
  })

  it('rejects a full-backup ExportPayload (no kind, wrong version)', () => {
    const fullBackup = {
      version: 4,
      exportedAt: 'x',
      projects: [],
      members: [],
      sprints: [],
      tasks: [],
    }
    expect(isProjectBundle(fullBackup)).toBe(false)
  })

  it('rejects null / non-object', () => {
    expect(isProjectBundle(null)).toBe(false)
    expect(isProjectBundle('nope')).toBe(false)
    expect(isProjectBundle(42)).toBe(false)
  })

  it('rejects a bundle with a missing array (truncated file)', () => {
    const b = sampleBundle() as unknown as Record<string, unknown>
    delete b.tasks
    expect(isProjectBundle(b)).toBe(false)
  })

  it('rejects a bundle whose project is not an object', () => {
    const b = { ...sampleBundle(), project: null }
    expect(isProjectBundle(b)).toBe(false)
  })
})

describe('remapBundle', () => {
  it('regenerates every id and rewrites projectId on all rows', () => {
    const b = sampleBundle()
    const out = remapBundle(b, counter())

    expect(out.project.id).not.toBe('p1')
    const pid = out.project.id
    expect(out.members[0].id).not.toBe('m1')
    expect(out.sprints[0].id).not.toBe('s1')
    expect(out.collections[0].id).not.toBe('c1')
    for (const t of out.tasks) expect(t.id).not.toBe(undefined)
    expect(new Set(out.tasks.map((t) => t.id)).size).toBe(3)

    // every row points at the new project
    expect(out.members.every((m) => m.projectId === pid)).toBe(true)
    expect(out.sprints.every((s) => s.projectId === pid)).toBe(true)
    expect(out.collections.every((c) => c.projectId === pid)).toBe(true)
    expect(out.tasks.every((t) => t.projectId === pid)).toBe(true)
    expect(out.events.every((e) => e.projectId === pid)).toBe(true)
  })

  it('rewrites task references (sprint, assignee, collection, section, status) to new ids', () => {
    const out = remapBundle(sampleBundle(), counter())
    const newSprintId = out.sprints[0].id
    const newMemberId = out.members[0].id
    const coll = out.collections[0]

    const t1 = out.tasks.find((t) => t.sequence === 1)!
    expect(t1.sprintId).toBe(newSprintId)
    expect(t1.assigneeId).toBe(newMemberId)

    const t2 = out.tasks.find((t) => t.sequence === 2)!
    expect(t2.collectionId).toBe(coll.id)
    // section/status point at the NEW nested ids of that collection
    expect(coll.sections.map((s) => s.id)).toContain(t2.sectionId)
    expect(coll.statuses.map((s) => s.id)).toContain(t2.collectionStatusId)
    expect(t2.sectionId).not.toBe('sec2')
    expect(t2.collectionStatusId).not.toBe('st2')
  })

  it('rewrites intra-bundle dependsOn and parentId to new task ids', () => {
    const out = remapBundle(sampleBundle(), counter())
    const t1 = out.tasks.find((t) => t.sequence === 1)!
    const t3 = out.tasks.find((t) => t.sequence === 3)!
    expect(t3.dependsOn).toEqual([t1.id])
    expect(t3.parentId).toBe(t1.id)
  })

  it('preserves Task.sequence verbatim', () => {
    const out = remapBundle(sampleBundle(), counter())
    expect(out.tasks.map((t) => t.sequence).sort()).toEqual([1, 2, 3])
  })

  it('keeps assigneeId null as null (unassigned, never a map lookup)', () => {
    const out = remapBundle(sampleBundle(), counter())
    const t2 = out.tasks.find((t) => t.sequence === 2)!
    expect(t2.assigneeId).toBeNull()
  })

  it('drops dangling dependsOn (target outside the bundle)', () => {
    const b = sampleBundle()
    b.tasks[2].dependsOn = ['t1', 'ghost'] // ghost is not in the bundle
    const out = remapBundle(b, counter())
    const t1 = out.tasks.find((t) => t.sequence === 1)!
    const t3 = out.tasks.find((t) => t.sequence === 3)!
    expect(t3.dependsOn).toEqual([t1.id]) // ghost dropped, t1 remapped
  })

  it('nulls a dangling parentId (target outside the bundle)', () => {
    const b = sampleBundle()
    b.tasks[2].parentId = 'ghost'
    const out = remapBundle(b, counter())
    const t3 = out.tasks.find((t) => t.sequence === 3)!
    expect(t3.parentId).toBeNull()
  })

  it('nulls a dangling sectionId / collectionStatusId', () => {
    const b = sampleBundle()
    b.tasks[1].sectionId = 'ghost'
    b.tasks[1].collectionStatusId = 'ghost'
    const out = remapBundle(b, counter())
    const t2 = out.tasks.find((t) => t.sequence === 2)!
    expect(t2.sectionId).toBeNull()
    expect(t2.collectionStatusId).toBeNull()
  })

  it('keeps a sprint-level event (null taskId) and remaps its sprintId', () => {
    const out = remapBundle(sampleBundle(), counter())
    const sprintEv = out.events.find((e) => e.kind === 'sprint_started')!
    expect(sprintEv.taskId).toBeNull()
    expect(sprintEv.sprintId).toBe(out.sprints[0].id)
  })

  it('remaps a task-level event taskId to the new task id', () => {
    const out = remapBundle(sampleBundle(), counter())
    const t1 = out.tasks.find((t) => t.sequence === 1)!
    const created = out.events.find((e) => e.kind === 'created')!
    expect(created.taskId).toBe(t1.id)
  })

  it('drops a task-level event whose taskId is not in the bundle', () => {
    const b = sampleBundle()
    b.events[0].taskId = 'ghost' // a 'created' event for a task not present
    const out = remapBundle(b, counter())
    expect(out.events.find((e) => e.kind === 'created')).toBeUndefined()
    // the sprint-level event survives
    expect(out.events.find((e) => e.kind === 'sprint_started')).toBeDefined()
  })

  it('leaves frozen event display fields (taskSeq/taskTitle) verbatim', () => {
    const out = remapBundle(sampleBundle(), counter())
    const created = out.events.find((e) => e.kind === 'created')!
    expect(created.taskSeq).toBe(1)
    expect(created.taskTitle).toBe('First')
  })

  it('round-trips empty collections/events without error', () => {
    const b = sampleBundle()
    b.collections = []
    b.events = []
    b.tasks = b.tasks.map((t) => ({
      ...t,
      collectionId: null,
      sectionId: null,
      collectionStatusId: null,
    }))
    const out = remapBundle(b, counter())
    expect(out.collections).toEqual([])
    expect(out.events).toEqual([])
    expect(out.tasks).toHaveLength(3)
  })

  it('re-importing (remapping twice) yields disjoint id sets — no collision', () => {
    const b = sampleBundle()
    const a = remapBundle(b, counter())
    const c = remapBundle(b, counter())
    // Use distinct factories → ids overlap (both start n1); the real guarantee
    // is that ids are regenerated, not preserved. With ONE shared factory the
    // two copies are fully disjoint:
    const shared = counter()
    const a2 = remapBundle(b, shared)
    const c2 = remapBundle(b, shared)
    const ids = (x: ProjectBundle) => [
      x.project.id,
      ...x.members.map((m) => m.id),
      ...x.sprints.map((s) => s.id),
      ...x.collections.map((col) => col.id),
      ...x.tasks.map((t) => t.id),
      ...x.events.map((e) => e.id),
    ]
    const overlap = ids(a2).filter((id) => ids(c2).includes(id))
    expect(overlap).toEqual([])
    // sanity: independent remaps don't mutate the source bundle
    expect(b.project.id).toBe('p1')
    expect(a.project.id).not.toBe('p1')
    expect(c.project.id).not.toBe('p1')
  })
})
