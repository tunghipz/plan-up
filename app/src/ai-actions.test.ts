import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { executeAiActions } from './ai/actions'
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
    [db.projects, db.people, db.members, db.sprints, db.tasks, db.events],
    async () => {
      await db.events.clear()
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
  const [project, sprint, members, tasks] = await Promise.all([
    db.projects.get(P),
    db.sprints.get(S),
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
    members,
    tasks,
  }
}

describe('AI actions', () => {
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
})
