import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  uid,
  addSprintTask,
  addCollectionItem,
  createCollection,
  updateTask,
  logStatusChange,
  setDependencies,
  moveUnfinishedToNextSprint,
  recomputeAllDates,
  logEvent,
  sprintEvents,
  exportAll,
  importAll,
  type Member,
} from './db'

// Sprint-wide activity log — dedicated `events` store (design-docs/sprint-activity-log.md,
// storage model A). These tests pin the LOGGING behavior at each write site + the
// per-sprint query; the React page is verified separately.

const P = 'test-project'
const S1 = 'sprint-1'
const S2 = 'sprint-2'

async function seedSprints() {
  await db.sprints.bulkAdd([
    { id: S1, projectId: P, name: 'Sprint 1', startDate: '2026-06-01', endDate: '2026-06-14' },
    { id: S2, projectId: P, name: 'Sprint 2', startDate: '2026-06-15', endDate: '2026-06-28' },
  ])
}

async function addMember(name: string): Promise<Member> {
  const m: Member = { id: uid(), projectId: P, name, color: '#000', daysOff: [] }
  await db.members.add(m)
  return m
}

beforeEach(async () => {
  await db.transaction(
    'rw',
    [db.projects, db.members, db.sprints, db.tasks, db.collections, db.events],
    async () => {
      await db.events.clear()
      await db.tasks.clear()
      await db.collections.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.projects.clear()
      await db.projects.add({ id: P, name: 'Test', createdAt: 0 })
    }
  )
})

describe('activity log — write-site logging', () => {
  it('logs a `created` event when a sprint task is added', async () => {
    await seedSprints()
    const t = await addSprintTask({ projectId: P, sprintId: S1, title: 'Login page', startDate: '2026-06-01' })

    const events = await sprintEvents(S1)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('created')
    expect(events[0].taskId).toBe(t.id)
    expect(events[0].taskTitle).toBe('Login page')
    expect(events[0].sprintId).toBe(S1)
  })

  it('logs an `edit` event with field/from/to on a status change via updateTask', async () => {
    await seedSprints()
    const t = await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })

    await updateTask(t.id, { status: 'in_progress' })

    const edits = (await sprintEvents(S1)).filter((e) => e.kind === 'edit' && e.field === 'status')
    expect(edits).toHaveLength(1)
    expect(edits[0].from).toBe('todo')
    expect(edits[0].to).toBe('in_progress')
    expect(edits[0].taskId).toBe(t.id)
  })

  it('freezes the member NAME on an assignee edit (survives deletion)', async () => {
    await seedSprints()
    const an = await addMember('An')
    const t = await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })

    await updateTask(t.id, { assigneeId: an.id })

    const edit = (await sprintEvents(S1)).find((e) => e.kind === 'edit' && e.field === 'assigneeId')
    expect(edit?.from).toBeNull()
    expect(edit?.to).toBe('An')
  })

  it('coalesces rapid title edits into a single event (audit log, not keystroke flood)', async () => {
    await seedSprints()
    const t = await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })

    await updateTask(t.id, { title: 'Ab' })
    await updateTask(t.id, { title: 'Abc' })

    const titleEvents = (await sprintEvents(S1)).filter((e) => e.kind === 'edit' && e.field === 'title')
    expect(titleEvents).toHaveLength(1)
    expect(titleEvents[0].to).toBe('Abc')
  })

  it('logs a board status change made through logStatusChange', async () => {
    await seedSprints()
    const t = await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })

    await logStatusChange(t.id, 'todo', 'done')

    const edit = (await sprintEvents(S1)).find((e) => e.kind === 'edit' && e.field === 'status')
    expect(edit?.to).toBe('done')
  })

  it('logs a prereq edit (dependsOn) through setDependencies', async () => {
    await seedSprints()
    const a = await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })
    const b = await addSprintTask({ projectId: P, sprintId: S1, title: 'B', startDate: '2026-06-01' })

    await setDependencies(b.id, [a.id])

    const prereq = (await sprintEvents(S1)).find((e) => e.kind === 'edit' && e.field === 'dependsOn')
    expect(prereq).toBeTruthy()
    expect(prereq?.to).toBe('1') // A is seq 1 in the sprint
  })

  it('logs a `rolled_over` event for each task moved to the next sprint', async () => {
    await seedSprints()
    await addSprintTask({ projectId: P, sprintId: S1, title: 'Carryover', startDate: '2026-06-01' })

    await moveUnfinishedToNextSprint(S1)

    const rolled = (await sprintEvents(S2)).filter((e) => e.kind === 'rolled_over')
    expect(rolled).toHaveLength(1)
    expect(rolled[0].taskTitle).toBe('Carryover')
    expect(rolled[0].from).toBe('Sprint 1')
  })
})

describe('activity log — exclusions & query', () => {
  it('does NOT log edits to a collection task (no sprintId)', async () => {
    await seedSprints()
    const col = await createCollection(P, 'Backlog')
    const item = await addCollectionItem(col.id, col.sections[0].id, { title: 'X' })

    await updateTask(item.id, { status: 'in_progress' })

    // collection task has sprintId=null → contributes to no sprint's log
    const all = await db.events.toArray()
    expect(all).toHaveLength(0)
  })

  it('does NOT log scheduler recomputes', async () => {
    await seedSprints()
    await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })
    await db.events.clear()

    await recomputeAllDates()

    expect(await db.events.toArray()).toHaveLength(0)
  })

  it('sprintEvents returns newest-first (ts desc) and scopes to one sprint', async () => {
    await seedSprints()
    await logEvent({ projectId: P, sprintId: S1, taskId: null, taskSeq: null, taskTitle: 'old', kind: 'sprint_started', from: null, to: null, ts: 100 })
    await logEvent({ projectId: P, sprintId: S1, taskId: null, taskSeq: null, taskTitle: 'new', kind: 'sprint_started', from: null, to: null, ts: 300 })
    await logEvent({ projectId: P, sprintId: S2, taskId: null, taskSeq: null, taskTitle: 'other', kind: 'sprint_started', from: null, to: null, ts: 200 })

    const events = await sprintEvents(S1)
    expect(events.map((e) => e.ts)).toEqual([300, 100])
  })
})

describe('activity log — export / import round-trip', () => {
  it('round-trips events through export → import', async () => {
    await seedSprints()
    await addSprintTask({ projectId: P, sprintId: S1, title: 'A', startDate: '2026-06-01' })
    const before = await db.events.toArray()
    expect(before.length).toBeGreaterThan(0)

    const payload = await exportAll()
    await importAll(payload)

    const after = await db.events.toArray()
    expect(after).toHaveLength(before.length)
    expect(after[0].kind).toBe('created')
  })
})
