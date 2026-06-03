import Dexie, { type Table } from 'dexie'

export type Status = 'todo' | 'in_progress' | 'done'
export type Priority = 'urgent' | 'high' | 'normal' | 'low' | 'none'

export interface Member {
  id: string
  name: string
  color: string
}

export interface Sprint {
  id: string
  name: string
  startDate: string
  endDate: string
}

export interface Task {
  id: string
  title: string
  assigneeId: string | null
  sprintId: string
  status: Status
  priority: Priority
  startDate: string | null
  dueDate: string | null
  estimate: number | null
  createdAt: number
  /** IDs of tasks that must be `done` before this one can start. */
  dependsOn: string[]
}

class PlanDB extends Dexie {
  members!: Table<Member, string>
  sprints!: Table<Sprint, string>
  tasks!: Table<Task, string>

  constructor() {
    super('plan-tmp')
    this.version(1).stores({
      members: 'id, name',
      sprints: 'id, startDate',
      tasks: 'id, sprintId, assigneeId, status, createdAt',
    })
    // v2 (2026-06-03): add Task.startDate. Indexes unchanged; just backfill data.
    this.version(2).upgrade((tx) =>
      tx
        .table('tasks')
        .toCollection()
        .modify((t: Task) => {
          if (t.startDate === undefined) t.startDate = null
        })
    )
    // v3 (2026-06-03): add Task.dependsOn (array of task IDs). Backfill [].
    this.version(3).upgrade((tx) =>
      tx
        .table('tasks')
        .toCollection()
        .modify((t: Task) => {
          if (!Array.isArray(t.dependsOn)) t.dependsOn = []
        })
    )
  }
}

export const db = new PlanDB()

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)

const PALETTE = [
  '#a855f7', '#f97316', '#3b82f6', '#10b981',
  '#ef4444', '#eab308', '#ec4899', '#14b8a6',
]
export function colorForName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/**
 * Cascade-safe task delete: also strips the task ID from any other task's
 * `dependsOn` array so we don't leave dangling references.
 */
export async function deleteTask(taskId: string) {
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.delete(taskId)
    // Walk all tasks that reference this one and patch them.
    const dependents = await db.tasks
      .filter((t) => t.dependsOn?.includes(taskId))
      .toArray()
    for (const d of dependents) {
      await db.tasks.update(d.id, {
        dependsOn: d.dependsOn.filter((id) => id !== taskId),
      })
    }
  })
}

/**
 * Returns true if adding `newDepId` to `taskId`'s dependsOn would form a cycle.
 * A cycle exists if `taskId` is reachable from `newDepId` via existing edges.
 */
export function wouldCreateCycle(
  taskId: string,
  newDepId: string,
  tasks: Task[]
): boolean {
  if (taskId === newDepId) return true
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const stack = [newDepId]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === taskId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const t = byId.get(cur)
    if (t) stack.push(...t.dependsOn)
  }
  return false
}

/**
 * Add `depId` as a prerequisite of `taskId`. Refuses cycles silently
 * (returns false). Returns true on success.
 */
export async function addDependency(
  taskId: string,
  depId: string
): Promise<boolean> {
  if (taskId === depId) return false
  const tasks = await db.tasks.toArray()
  if (wouldCreateCycle(taskId, depId, tasks)) return false
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return false
  if (task.dependsOn.includes(depId)) return true // already there
  await db.tasks.update(taskId, {
    dependsOn: [...task.dependsOn, depId],
  })
  return true
}

export async function removeDependency(taskId: string, depId: string) {
  const task = await db.tasks.get(taskId)
  if (!task) return
  await db.tasks.update(taskId, {
    dependsOn: task.dependsOn.filter((id) => id !== depId),
  })
}

/**
 * A task is "blocked" if any of its prerequisites is not yet `done`.
 * Done tasks themselves are never blocked (visual nicety).
 */
export function isTaskBlocked(task: Task, byId: Map<string, Task>): boolean {
  if (task.status === 'done') return false
  if (!task.dependsOn || task.dependsOn.length === 0) return false
  return task.dependsOn.some((id) => {
    const dep = byId.get(id)
    return dep && dep.status !== 'done'
  })
}

// Cascade-safe member delete: orphaned tasks become Unassigned (assigneeId=null)
// rather than disappearing from the UI.
export async function deleteMember(memberId: string) {
  await db.transaction('rw', db.members, db.tasks, async () => {
    await db.tasks
      .where('assigneeId')
      .equals(memberId)
      .modify({ assigneeId: null })
    await db.members.delete(memberId)
  })
}

export interface ExportPayload {
  version: 1
  exportedAt: string
  members: Member[]
  sprints: Sprint[]
  tasks: Task[]
}

export async function exportAll(): Promise<ExportPayload> {
  const [members, sprints, tasks] = await Promise.all([
    db.members.toArray(),
    db.sprints.toArray(),
    db.tasks.toArray(),
  ])
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    members,
    sprints,
    tasks,
  }
}

export async function importAll(data: ExportPayload) {
  if (!data || data.version !== 1) throw new Error('Unsupported export version')
  await db.transaction('rw', db.members, db.sprints, db.tasks, async () => {
    await db.members.clear()
    await db.sprints.clear()
    await db.tasks.clear()
    await db.members.bulkAdd(data.members)
    await db.sprints.bulkAdd(data.sprints)
    // Backfill missing fields from older exports (pre-startDate). Older
    // payloads may have `startDate === undefined` at runtime even though the
    // declared type is `string | null`. The `??` covers both cases.
    const tasks: Task[] = data.tasks.map((t) => ({
      ...t,
      startDate: t.startDate ?? null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
    }))
    await db.tasks.bulkAdd(tasks)
  })
}

// Module-level promise lock prevents StrictMode double-mount from seeding twice.
let seedPromise: Promise<void> | null = null
export function seedIfEmpty(): Promise<void> {
  if (!seedPromise) seedPromise = doSeed()
  return seedPromise
}
/** Test-only: reset the per-module seed lock so a freshly cleared DB can re-seed. */
export function __resetSeedLockForTests() {
  seedPromise = null
}

/**
 * Merge sprints with duplicate names (legacy artifact of pre-lock seed race).
 * For each duplicate group: keep the sprint with most tasks, reassign tasks
 * from duplicates to keeper, then delete the duplicates. Idempotent.
 * Returns the number of duplicate sprints removed.
 */
export async function dedupeSprints(): Promise<number> {
  return db.transaction('rw', db.sprints, db.tasks, async () => {
    const sprints = await db.sprints.toArray()
    const tasks = await db.tasks.toArray()

    const byName = new Map<string, Sprint[]>()
    for (const s of sprints) {
      const bucket = byName.get(s.name) ?? []
      bucket.push(s)
      byName.set(s.name, bucket)
    }

    let removed = 0
    for (const group of byName.values()) {
      if (group.length <= 1) continue
      // keep the sprint with the most tasks (tie-break: earliest startDate)
      group.sort((a, b) => {
        const ca = tasks.filter((t) => t.sprintId === a.id).length
        const cb = tasks.filter((t) => t.sprintId === b.id).length
        if (cb !== ca) return cb - ca
        return a.startDate.localeCompare(b.startDate)
      })
      const keeper = group[0]
      const dups = group.slice(1)
      for (const dup of dups) {
        await db.tasks
          .where('sprintId')
          .equals(dup.id)
          .modify({ sprintId: keeper.id })
        await db.sprints.delete(dup.id)
        removed++
      }
    }
    return removed
  })
}

async function doSeed() {
  await db.transaction('rw', db.members, db.sprints, db.tasks, async () => {
    const memberCount = await db.members.count()
    if (memberCount > 0) return

    await seedFresh()
  })
}

async function seedFresh() {
  const names = ['Alice', 'Bob', 'Charlie']
  const members: Member[] = names.map((name) => ({
    id: uid(),
    name,
    color: colorForName(name),
  }))
  await db.members.bulkAdd(members)

  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + 13)
  const sprint: Sprint = {
    id: uid(),
    name: 'Sprint 1',
    startDate: today.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
  await db.sprints.add(sprint)

  await db.tasks.add({
    id: uid(),
    title: 'Welcome — click to edit, or use ＋ Add Task',
    assigneeId: members[0].id,
    sprintId: sprint.id,
    status: 'in_progress',
    priority: 'normal',
    startDate: today.toISOString().slice(0, 10),
    dueDate: null,
    estimate: null,
    createdAt: Date.now(),
    dependsOn: [],
  })
}
