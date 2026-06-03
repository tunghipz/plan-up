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
  /** Stable, never-reused sequence number. Used in the UI for prereq input. */
  sequence: number
  title: string
  assigneeId: string | null
  sprintId: string
  status: Status
  priority: Priority
  startDate: string | null
  dueDate: string | null
  /** Effort in days. Drives end-date computation when prereqs exist. */
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
    // v4 (2026-06-03): add Task.sequence. Backfill in createdAt order so
    // existing rows get stable 1, 2, 3, ... numbers.
    this.version(4).upgrade(async (tx) => {
      const rows = await tx.table('tasks').toArray()
      rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      let n = 1
      for (const r of rows) {
        await tx.table('tasks').update(r.id, { sequence: n++ })
      }
    })
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

/** Next available sequence number. Sequences are never reused. */
export async function nextSequence(): Promise<number> {
  const all = await db.tasks.toArray()
  let max = 0
  for (const t of all) if ((t.sequence ?? 0) > max) max = t.sequence ?? 0
  return max + 1
}

/**
 * Add `days` calendar days to a yyyy-mm-dd string. Returns yyyy-mm-dd.
 * Anchored in UTC so the result is timezone-independent.
 */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Compute (start, end) for a task based on its prereqs and effort.
 * - If task has no prereqs: returns (task.startDate, task.dueDate) — manual.
 * - If prereqs exist: start = max(prereq.dueDate) + 1 day.
 * - end = start + (estimate - 1) days; if no estimate, end = start.
 * Returns null fields if the calculation can't run (e.g. no prereq has an end).
 */
export function computeStartEnd(
  task: Task,
  byId: Map<string, Task>
): { startDate: string | null; dueDate: string | null } {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return { startDate: task.startDate, dueDate: task.dueDate }
  }
  const ends = task.dependsOn
    .map((id) => byId.get(id)?.dueDate)
    .filter((d): d is string => Boolean(d))
  if (ends.length === 0) {
    return { startDate: task.startDate, dueDate: task.dueDate }
  }
  const latest = ends.reduce((a, b) => (a > b ? a : b))
  const start = addDays(latest, 1)
  const effort = task.estimate && task.estimate > 0 ? task.estimate : 1
  const end = addDays(start, effort - 1)
  return { startDate: start, dueDate: end }
}

/**
 * Recompute dates for `taskId` and walk forward to any tasks that depend on
 * it. Idempotent — stops when a task's computed dates equal current ones.
 */
export async function recomputeDates(taskId: string): Promise<void> {
  await db.transaction('rw', db.tasks, async () => {
    const visited = new Set<string>()
    const queue: string[] = [taskId]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const all = await db.tasks.toArray()
      const byId = new Map(all.map((t) => [t.id, t]))
      const task = byId.get(id)
      if (!task) continue
      const next = computeStartEnd(task, byId)
      if (
        next.startDate !== task.startDate ||
        next.dueDate !== task.dueDate
      ) {
        await db.tasks.update(id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
      }
      // Enqueue dependents (tasks where dependsOn includes this id).
      for (const t of all) {
        if (t.dependsOn?.includes(id) && !visited.has(t.id)) {
          queue.push(t.id)
        }
      }
    }
  })
}

/**
 * Cascade-safe task delete: also strips the task ID from any other task's
 * `dependsOn` array so we don't leave dangling references.
 */
export async function deleteTask(taskId: string) {
  const touched: string[] = []
  await db.transaction('rw', db.tasks, async () => {
    await db.tasks.delete(taskId)
    const dependents = await db.tasks
      .filter((t) => t.dependsOn?.includes(taskId))
      .toArray()
    for (const d of dependents) {
      await db.tasks.update(d.id, {
        dependsOn: d.dependsOn.filter((id) => id !== taskId),
      })
      touched.push(d.id)
    }
  })
  for (const id of touched) await recomputeDates(id)
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
  await recomputeDates(taskId)
  return true
}

export async function removeDependency(taskId: string, depId: string) {
  const task = await db.tasks.get(taskId)
  if (!task) return
  await db.tasks.update(taskId, {
    dependsOn: task.dependsOn.filter((id) => id !== depId),
  })
  await recomputeDates(taskId)
}

/**
 * Replace the full dependency set for `taskId`. Filters out self-links and
 * any edge that would create a cycle. Returns the cleaned array that was
 * actually saved.
 */
export async function setDependencies(
  taskId: string,
  depIds: string[]
): Promise<string[]> {
  const tasks = await db.tasks.toArray()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return []
  const clean: string[] = []
  // Build cumulatively so a later dep can't bypass a cycle check via an
  // earlier dep we're about to add in the same call.
  const probe = { ...task, dependsOn: [] as string[] }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  byId.set(taskId, probe)
  for (const id of depIds) {
    if (id === taskId) continue
    if (clean.includes(id)) continue
    if (!byId.has(id)) continue
    if (wouldCreateCycle(taskId, id, Array.from(byId.values()))) continue
    clean.push(id)
    probe.dependsOn = clean
  }
  await db.tasks.update(taskId, { dependsOn: clean })
  await recomputeDates(taskId)
  return clean
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
    let seq = 1
    const sorted = [...data.tasks].sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
    )
    const tasks: Task[] = sorted.map((t) => ({
      ...t,
      startDate: t.startDate ?? null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      sequence: typeof t.sequence === 'number' ? t.sequence : seq++,
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
    sequence: 1,
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
