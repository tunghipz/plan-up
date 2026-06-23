import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { executeAiActions, normalizeAiActions } from './ai/actions'
import { addCollectionItem, createCollection } from './db'
import {
  addMember,
  addSprintTask,
  db,
  type AiRuntimeContext,
} from './test-helpers/ai-context'

const P = 'test-project'
const S = 'sprint-1'

beforeEach(async () => {
  await db.transaction(
    'rw',
    [db.projects, db.people, db.members, db.sprints, db.tasks, db.collections, db.events],
    async () => {
      await db.events.clear()
      await db.collections.clear()
      await db.tasks.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.people.clear()
      await db.projects.clear()
      await db.projects.add({ id: P, name: 'Test', createdAt: 0 })
      await db.sprints.add({
        id: S,
        projectId: P,
        name: 'Sprint 1',
        startDate: '2026-06-01',
        endDate: '2026-06-14',
      })
    }
  )
})

async function ctx(): Promise<AiRuntimeContext> {
  const [project, sprint, sprints, collections, members, tasks] = await Promise.all([
    db.projects.get(P),
    db.sprints.get(S),
    db.sprints.where('projectId').equals(P).toArray(),
    db.collections.where('projectId').equals(P).toArray(),
    db.members.where('projectId').equals(P).toArray(),
    db.tasks.where('sprintId').equals(S).toArray(),
  ])
  return {
    today: '2026-06-23',
    screen: 'project',
    containerKind: 'sprint',
    view: 'list',
    project: project ?? null,
    sprint: sprint ?? null,
    collection: null,
    collections,
    sprints,
    members,
    tasks,
  }
}

describe('AI actions', () => {
  it('normalizes delete task and create sprint model actions', () => {
    expect(
      normalizeAiActions([
        { type: 'delete_task', taskSeq: '2' },
        { type: 'create_sprint', startDate: '2026-06-29', note: 'Next wave' },
        { type: 'update_member', memberName: 'An', name: 'An Nguyen', title: null },
        { type: 'update_milestone', taskSeq: '3', date: '2026-06-10' },
        { type: 'move_task_to_next_sprint', taskSeq: '4' },
        { type: 'move_task_to_sprint', taskSeq: '5', sprintName: 'Sprint 2' },
        { type: 'move_task_to_collection', taskSeq: '6', collectionName: 'Roadmap' },
        { type: 'add_sprint_note', note: '  Bug bash  ' },
      ])
    ).toEqual([
      { type: 'delete_task', taskSeq: 2 },
      { type: 'create_sprint', startDate: '2026-06-29', note: 'Next wave' },
      { type: 'update_member', memberName: 'An', name: 'An Nguyen', title: null },
      { type: 'update_milestone', taskSeq: 3, date: '2026-06-10' },
      { type: 'move_task_to_next_sprint', taskSeq: 4 },
      { type: 'move_task_to_sprint', taskSeq: 5, sprintName: 'Sprint 2' },
      { type: 'move_task_to_collection', taskSeq: 6, collectionName: 'Roadmap' },
      { type: 'add_sprint_note', note: 'Bug bash' },
    ])
  })

  it('normalizes collection model actions', () => {
    expect(
      normalizeAiActions([
        { type: 'create_collection', name: '  Roadmap  ' },
        { type: 'update_collection', collectionName: 'Roadmap', name: '  Q3 Roadmap  ' },
        { type: 'delete_collection', collectionId: 'collection-1' },
      ])
    ).toEqual([
      { type: 'create_collection', name: 'Roadmap' },
      { type: 'update_collection', collectionName: 'Roadmap', name: 'Q3 Roadmap' },
      { type: 'delete_collection', collectionId: 'collection-1' },
    ])
  })

  it('keeps at most 100 normalized actions per response', () => {
    const actions = normalizeAiActions(
      Array.from({ length: 101 }, (_, i) => ({
        type: 'create_collection',
        name: `Collection ${i + 1}`,
      }))
    )

    expect(actions).toHaveLength(100)
    expect(actions[99]).toEqual({ type: 'create_collection', name: 'Collection 100' })
  })

  it('creates a sprint task through the canonical write path', async () => {
    const an = await addMember(P, 'An')

    const results = await executeAiActions(
      [{ type: 'create_task', title: 'Design login', assigneeName: 'An', estimate: 2 }],
      await ctx()
    )

    expect(results[0].ok).toBe(true)
    const task = await db.tasks.where('sprintId').equals(S).first()
    expect(task?.title).toBe('Design login')
    expect(task?.assigneeId).toBe(an.id)
    expect(task?.estimate).toBe(2)
    expect(await db.events.count()).toBeGreaterThan(0)
  })

  it('creates effort-zero milestones on the requested date', async () => {
    await executeAiActions(
      [{ type: 'create_milestone', title: 'Launch', date: '2026-06-10' }],
      await ctx()
    )

    const task = await db.tasks.where('sprintId').equals(S).first()
    expect(task?.title).toBe('Launch')
    expect(task?.estimate).toBe(0)
    expect(task?.startDate).toBe('2026-06-10')
    expect(task?.dueDate).toBe('2026-06-10')
  })

  it('updates tasks by sequence and rejects duplicate members', async () => {
    await addMember(P, 'An')
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Wireframes',
      startDate: '2026-06-01',
    })

    const updateResults = await executeAiActions(
      [{ type: 'update_task', taskSeq: task.sequence, status: 'done' }],
      await ctx()
    )
    const memberResults = await executeAiActions(
      [{ type: 'create_member', name: 'An' }],
      await ctx()
    )

    expect(updateResults[0].ok).toBe(true)
    expect((await db.tasks.get(task.id))?.status).toBe('done')
    expect(memberResults[0].ok).toBe(false)
    expect(await db.members.count()).toBe(1)
  })

  it('updates and deletes members by visible name', async () => {
    const an = await addMember(P, 'An')
    await addMember(P, 'Binh')
    await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Assigned work',
      startDate: '2026-06-01',
      assigneeId: an.id,
    })

    const updateResults = await executeAiActions(
      [{ type: 'update_member', memberName: 'An', name: 'An Nguyen', title: 'Lead' }],
      await ctx()
    )
    const deleteResults = await executeAiActions(
      [{ type: 'delete_member', memberName: 'An Nguyen' }],
      await ctx()
    )

    expect(updateResults[0]).toMatchObject({ ok: true })
    expect(deleteResults[0]).toMatchObject({ ok: true })
    expect(await db.members.get(an.id)).toBeUndefined()
    const task = await db.tasks.where('sprintId').equals(S).first()
    expect(task?.assigneeId).toBeNull()
  })

  it('creates, renames, and deletes collections through AI actions', async () => {
    const createResults = await executeAiActions(
      [{ type: 'create_collection', name: 'Roadmap' }],
      await ctx()
    )

    expect(createResults[0]).toMatchObject({
      ok: true,
      label: 'Created collection “Roadmap”',
    })
    const roadmap = await db.collections.where('projectId').equals(P).first()
    expect(roadmap).toMatchObject({ name: 'Roadmap' })

    const renameResults = await executeAiActions(
      [{ type: 'update_collection', name: 'Q3 Roadmap' }],
      {
        ...(await ctx()),
        containerKind: 'collection',
        collection: roadmap ?? null,
      }
    )

    expect(renameResults[0]).toMatchObject({
      ok: true,
      label: 'Renamed collection “Roadmap” to “Q3 Roadmap”',
    })
    await expect(db.collections.get(roadmap!.id)).resolves.toMatchObject({
      name: 'Q3 Roadmap',
    })

    const deleteResults = await executeAiActions(
      [{ type: 'delete_collection', collectionName: 'Q3 Roadmap' }],
      await ctx()
    )

    expect(deleteResults[0]).toMatchObject({
      ok: true,
      label: 'Deleted collection “Q3 Roadmap”',
    })
    expect(await db.collections.get(roadmap!.id)).toBeUndefined()
  })

  it('treats a collection named Backlog as a normal collection', async () => {
    const backlog = await createCollection(P, 'Backlog')

    const renameResults = await executeAiActions(
      [{ type: 'update_collection', collectionId: backlog.id, name: 'Ideas' }],
      {
        ...(await ctx()),
        collection: backlog,
      }
    )
    const deleteResults = await executeAiActions(
      [{ type: 'delete_collection', collectionName: 'Ideas' }],
      {
        ...(await ctx()),
        collection: { ...backlog, name: 'Ideas' },
      }
    )

    expect(renameResults[0]).toMatchObject({
      ok: true,
      label: 'Renamed collection “Backlog” to “Ideas”',
    })
    expect(deleteResults[0]).toMatchObject({ ok: true, label: 'Deleted collection “Ideas”' })
    expect(await db.collections.get(backlog.id)).toBeUndefined()
  })

  it('assigns and deletes visible collection tasks', async () => {
    const [an, collection] = await Promise.all([
      addMember(P, 'An'),
      createCollection(P, 'Roadmap'),
    ])
    const item = await addCollectionItem(collection.id, collection.sections[0].id, {
      title: 'Unscheduled work',
    })
    const collectionCtx = {
      ...(await ctx()),
      containerKind: 'collection' as const,
      sprint: null,
      collection,
      tasks: [item],
    }

    const assignResults = await executeAiActions(
      [{ type: 'update_task', taskSeq: item.sequence, assigneeName: 'An' }],
      collectionCtx
    )

    expect(assignResults[0]).toMatchObject({ ok: true, label: 'Updated task #1' })
    await expect(db.tasks.get(item.id)).resolves.toMatchObject({ assigneeId: an.id })

    const deleteResults = await executeAiActions(
      [{ type: 'delete_task', taskSeq: item.sequence }],
      {
        ...collectionCtx,
        tasks: [(await db.tasks.get(item.id))!],
      }
    )

    expect(deleteResults[0]).toMatchObject({
      ok: true,
      label: 'Deleted task #1 “Unscheduled work”',
    })
    expect(await db.tasks.get(item.id)).toBeUndefined()
  })

  it('sets and removes member day off through the canonical scheduler path', async () => {
    const an = await addMember(P, 'An')
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Scheduled work',
      startDate: '2026-06-01',
      assigneeId: an.id,
    })
    await db.tasks.update(task.id, { estimate: 2 })

    const setResults = await executeAiActions(
      [{ type: 'set_member_day_off', memberName: 'An', date: '2026-06-02', halfDay: 'pm' }],
      await ctx()
    )

    expect(setResults[0]).toMatchObject({
      ok: true,
      label: 'Set An PM off on 2026-06-02',
    })
    await expect(db.members.get(an.id)).resolves.toMatchObject({
      daysOff: [{ date: '2026-06-02', half: 'pm' }],
    })

    const removeResults = await executeAiActions(
      [{ type: 'remove_member_day_off', memberName: 'An', date: '2026-06-02' }],
      await ctx()
    )

    expect(removeResults[0]).toMatchObject({
      ok: true,
      label: 'Removed An day off on 2026-06-02',
    })
    await expect(db.members.get(an.id)).resolves.toMatchObject({ daysOff: [] })
  })

  it('deletes tasks by sequence through the canonical delete path', async () => {
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Remove me',
      startDate: '2026-06-01',
    })

    const results = await executeAiActions(
      [{ type: 'delete_task', taskSeq: task.sequence }],
      await ctx()
    )

    expect(results[0]).toMatchObject({ ok: true })
    expect(await db.tasks.get(task.id)).toBeUndefined()
  })

  it('moves visible tasks into a named collection', async () => {
    const an = await addMember(P, 'An')
    const collection = await createCollection(P, 'Roadmap')
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Move to roadmap',
      startDate: '2026-06-03',
      assigneeId: an.id,
    })
    await db.tasks.update(task.id, { estimate: 2, dueDate: '2026-06-04' })

    const results = await executeAiActions(
      [{ type: 'move_task_to_collection', taskSeq: task.sequence, collectionName: 'Roadmap' }],
      await ctx()
    )

    expect(results[0]).toMatchObject({
      ok: true,
      label: 'Moved task #1 “Move to roadmap” to collection Roadmap',
    })
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({
      sprintId: null,
      collectionId: collection.id,
      sectionId: collection.sections[0].id,
      collectionStatusId: collection.statuses[0].id,
      assigneeId: an.id,
      startDate: '2026-06-03',
      dueDate: '2026-06-04',
      estimate: 2,
      dependsOn: [],
    })
  })

  it('moves visible tasks to the next sprint and into a named collection', async () => {
    await db.sprints.add({
      id: 'sprint-2',
      projectId: P,
      name: 'Sprint 2',
      startDate: '2026-06-15',
      endDate: '2026-06-28',
    })
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Move me',
      startDate: '2026-06-01',
    })

    const moveResults = await executeAiActions(
      [{ type: 'move_task_to_next_sprint', taskSeq: task.sequence }],
      await ctx()
    )

    expect(moveResults[0]).toMatchObject({ ok: true, label: 'Moved task #1 to Sprint 2' })
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({
      sprintId: 'sprint-2',
      collectionId: null,
      startDate: '2026-06-15',
    })
    const rolloverEvent = await db.events.where('sprintId').equals('sprint-2').first()
    expect(rolloverEvent).toMatchObject({ kind: 'rolled_over', taskId: task.id })

    const sprint2 = await db.sprints.get('sprint-2')
    const moved = await db.tasks.where('sprintId').equals('sprint-2').toArray()
    const backlog = await createCollection(P, 'Backlog')
    const collectionResults = await executeAiActions(
      [{ type: 'move_task_to_collection', taskSeq: moved[0].sequence, collectionName: 'Backlog' }],
      {
        ...(await ctx()),
        sprint: sprint2 ?? null,
        tasks: moved,
      }
    )

    expect(collectionResults[0]).toMatchObject({
      ok: true,
      label: 'Moved task #1 “Move me” to collection Backlog',
    })
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({
      sprintId: null,
      collectionId: backlog.id,
      sectionId: backlog.sections[0]?.id,
      assigneeId: null,
      startDate: '2026-06-15',
      dueDate: null,
      estimate: null,
      dependsOn: [],
    })

    const backlogTasks = await db.tasks.where('collectionId').equals(backlog.id).toArray()
    const toSprintResults = await executeAiActions(
      [{ type: 'move_task_to_sprint', taskSeq: backlogTasks[0].sequence, sprintName: 'Sprint 2' }],
      {
        ...(await ctx()),
        containerKind: 'collection',
        sprint: null,
        collection: backlog,
        tasks: backlogTasks,
      }
    )

    expect(toSprintResults[0]).toMatchObject({
      ok: true,
      label: 'Moved task #1 “Move me” to Sprint 2',
    })
    await expect(db.tasks.get(task.id)).resolves.toMatchObject({
      sprintId: 'sprint-2',
      collectionId: null,
      sectionId: null,
      collectionStatusId: null,
      startDate: '2026-06-15',
    })
  })

  it('creates sprints with automatic naming, cadence dates, notes, and events', async () => {
    const results = await executeAiActions(
      [{ type: 'create_sprint', note: 'Stabilize launch' }],
      await ctx()
    )

    expect(results[0]).toMatchObject({ ok: true, label: 'Created Sprint 2' })
    const sprints = await db.sprints.where('projectId').equals(P).toArray()
    const sprint = sprints.find((s) => s.name === 'Sprint 2')
    expect(sprint).toMatchObject({
      name: 'Sprint 2',
      startDate: '2026-06-22',
      endDate: '2026-07-05',
      note: 'Stabilize launch',
    })
    const event = await db.events.where('sprintId').equals(sprint!.id).first()
    expect(event?.kind).toBe('sprint_started')
  })

  it('updates and deletes the selected sprint', async () => {
    const updateResults = await executeAiActions(
      [{ type: 'update_sprint', startDate: '2026-06-08', note: 'Polish' }],
      await ctx()
    )

    expect(updateResults[0]).toMatchObject({ ok: true, label: 'Updated Sprint 1' })
    await expect(db.sprints.get(S)).resolves.toMatchObject({
      startDate: '2026-06-08',
      endDate: '2026-06-21',
      note: 'Polish',
    })

    const deleteResults = await executeAiActions([{ type: 'delete_sprint' }], await ctx())

    expect(deleteResults[0]).toMatchObject({ ok: true, label: 'Deleted Sprint 1' })
    expect(await db.sprints.get(S)).toBeUndefined()
  })

  it('adds a note to the selected sprint', async () => {
    const results = await executeAiActions(
      [{ type: 'add_sprint_note', note: 'Focus on bug bash' }],
      await ctx()
    )

    expect(results[0]).toMatchObject({ ok: true, label: 'Updated Sprint 1 note' })
    await expect(db.sprints.get(S)).resolves.toMatchObject({
      note: 'Focus on bug bash',
    })
  })

  it('updates and deletes milestones without affecting normal tasks', async () => {
    const milestone = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Beta',
      startDate: '2026-06-01',
    })
    await db.tasks.update(milestone.id, { estimate: 0, dueDate: '2026-06-01' })
    const task = await addSprintTask({
      projectId: P,
      sprintId: S,
      title: 'Normal work',
      startDate: '2026-06-01',
    })

    const updateResults = await executeAiActions(
      [{ type: 'update_milestone', taskSeq: milestone.sequence, title: 'Beta launch', date: '2026-06-12' }],
      await ctx()
    )

    expect(updateResults[0]).toMatchObject({ ok: true })
    await expect(db.tasks.get(milestone.id)).resolves.toMatchObject({
      title: 'Beta launch',
      startDate: '2026-06-12',
      dueDate: '2026-06-12',
      estimate: 0,
    })

    const rejectResults = await executeAiActions(
      [{ type: 'delete_milestone', taskSeq: task.sequence }],
      await ctx()
    )
    const deleteResults = await executeAiActions(
      [{ type: 'delete_milestone', taskSeq: milestone.sequence }],
      await ctx()
    )

    expect(rejectResults[0].ok).toBe(false)
    expect(deleteResults[0]).toMatchObject({ ok: true })
    expect(await db.tasks.get(milestone.id)).toBeUndefined()
    expect(await db.tasks.get(task.id)).toBeDefined()
  })

  it('rejects AI-created sprints that start off cadence', async () => {
    const results = await executeAiActions(
      [{ type: 'create_sprint', startDate: '2026-06-24' }],
      await ctx()
    )

    expect(results[0].ok).toBe(false)
    expect(results[0].detail).toContain('Monday')
    expect(await db.sprints.count()).toBe(1)
  })
})
