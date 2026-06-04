import Dexie, { type Table } from 'dexie'

export type Status = 'todo' | 'in_progress' | 'done'
export type Priority = 'urgent' | 'high' | 'normal' | 'low' | 'none'

/**
 * A day off for a member.
 * - `half` omitted → entire day off (contributes 0 to effort)
 * - `half: 'am'` → morning off, afternoon worked (contributes 0.5)
 * - `half: 'pm'` → afternoon off, morning worked (contributes 0.5)
 * AM vs PM is for human reference only; both half kinds contribute equally
 * (0.5 working day) since we don't model intra-day scheduling.
 */
export interface DayOff {
  date: string
  half?: 'am' | 'pm'
}

export interface Project {
  id: string
  name: string
  createdAt: number
  /** Optional free-text description, edited from the settings page. */
  description?: string
  /**
   * Optional hand-picked tile color (a hex from PALETTE). When unset, the UI
   * falls back to `colorForName(name)`. Non-indexed → no Dexie version bump.
   */
  color?: string
}

export interface Member {
  id: string
  projectId: string
  name: string
  color: string
  /**
   * Additional non-working days for this member, on top of weekends.
   * Pushes tasks forward when their start/end is computed from prereqs.
   */
  daysOff: DayOff[]
  /**
   * Optional free-text role label ("Backend Engineer", "Designer", "PM").
   * Pure display metadata — never affects scheduling/capacity/assignment.
   * Non-indexed, so it needs no Dexie version bump (same as Project.description).
   * See design-docs/member-title.md.
   */
  title?: string
}

export interface Sprint {
  id: string
  projectId: string
  name: string
  startDate: string
  endDate: string
}

export interface Task {
  id: string
  projectId: string
  /** Stable, never-reused sequence number (per-project). UI prereq input. */
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
  projects!: Table<Project, string>
  members!: Table<Member, string>
  sprints!: Table<Sprint, string>
  tasks!: Table<Task, string>

  constructor() {
    super('plan-up')
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
    // v5 (2026-06-03): add Member.daysOff (array of yyyy-mm-dd). Backfill [].
    this.version(5).upgrade((tx) =>
      tx
        .table('members')
        .toCollection()
        .modify((m: Member) => {
          if (!Array.isArray(m.daysOff)) m.daysOff = []
        })
    )
    // v6 (2026-06-03): daysOff shape changes from string[] to DayOff[]
    // (object with optional `half`). Convert old strings → {date: s}.
    this.version(6).upgrade((tx) =>
      tx
        .table('members')
        .toCollection()
        .modify((m: Member) => {
          const raw = m.daysOff as unknown as Array<string | DayOff>
          if (!Array.isArray(raw)) {
            m.daysOff = []
            return
          }
          m.daysOff = raw.map((d) =>
            typeof d === 'string' ? { date: d } : d
          )
        })
    )
    // v7 (2026-06-03): multi-project. Add projects table + projectId on
    // members/sprints/tasks. Backfill existing data to a default project.
    this.version(7)
      .stores({
        projects: 'id, name, createdAt',
        members: 'id, name, projectId',
        sprints: 'id, startDate, projectId',
        tasks: 'id, sprintId, assigneeId, status, createdAt, projectId',
      })
      .upgrade(async (tx) => {
        const projects = tx.table<Project>('projects')
        const existing = await projects.toArray()
        let defaultId: string
        if (existing.length > 0) {
          defaultId = existing[0].id
        } else {
          defaultId =
            typeof crypto !== 'undefined' && crypto.randomUUID
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2, 10)
          await projects.add({
            id: defaultId,
            name: 'My Project',
            createdAt: Date.now(),
          })
        }
        for (const table of ['members', 'sprints', 'tasks']) {
          await tx
            .table(table)
            .toCollection()
            .modify((row: { projectId?: string }) => {
              if (!row.projectId) row.projectId = defaultId
            })
        }
      })
    // v8 (2026-06-03): sequence becomes per-SPRINT (was per-project). Each
    // sprint resets at 1 so users see a clean 1..N column per sprint view.
    // Existing dependsOn references point to task IDs — unaffected.
    this.version(8).upgrade(async (tx) => {
      const tasks = await tx.table('tasks').toArray()
      const bySprint = new Map<string, typeof tasks>()
      for (const t of tasks) {
        const arr = bySprint.get(t.sprintId) ?? []
        arr.push(t)
        bySprint.set(t.sprintId, arr)
      }
      for (const arr of bySprint.values()) {
        arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        let n = 1
        for (const t of arr) {
          await tx.table('tasks').update(t.id, { sequence: n++ })
        }
      }
    })
  }
}

export const db = new PlanDB()

export const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)

export const PALETTE = [
  '#a855f7', '#f97316', '#3b82f6', '#10b981',
  '#ef4444', '#eab308', '#ec4899', '#14b8a6',
]
export function colorForName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/** Next sequence number within a sprint. Sequences are never reused. */
export async function nextSequence(sprintId: string): Promise<number> {
  const all = await db.tasks.where('sprintId').equals(sprintId).toArray()
  let max = 0
  for (const t of all) if ((t.sequence ?? 0) > max) max = t.sequence ?? 0
  return max + 1
}

/**
 * Create a new project. The new project is empty — caller is responsible
 * for adding members / sprints. Returns the created project.
 */
export async function createProject(name: string): Promise<Project> {
  const trimmed = name.trim() || 'Untitled Project'
  const project: Project = { id: uid(), name: trimmed, createdAt: Date.now() }
  await db.projects.add(project)
  return project
}

/**
 * Patch a project's editable fields (name / description / color). Name is
 * never emptied — callers should pass a trimmed, non-empty name.
 */
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'color'>>
): Promise<void> {
  await db.projects.update(id, patch)
}

/**
 * Delete a project and everything it owns: members, sprints, tasks. Tasks
 * in this project that are referenced as dependsOn by tasks in OTHER
 * projects (rare) are stripped from those references.
 */
export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
    async () => {
      const taskIds = (
        await db.tasks.where('projectId').equals(projectId).toArray()
      ).map((t) => t.id)
      // Strip cross-project dep references (paranoid; same-project case is
      // moot because dependents are deleted alongside).
      const taskIdSet = new Set(taskIds)
      const others = await db.tasks
        .filter((t) => t.projectId !== projectId && t.dependsOn?.some((id) => taskIdSet.has(id)))
        .toArray()
      for (const t of others) {
        await db.tasks.update(t.id, {
          dependsOn: t.dependsOn.filter((id) => !taskIdSet.has(id)),
        })
      }
      await db.tasks.where('projectId').equals(projectId).delete()
      await db.sprints.where('projectId').equals(projectId).delete()
      await db.members.where('projectId').equals(projectId).delete()
      await db.projects.delete(projectId)
    }
  )
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

/** True if the date falls on Saturday or Sunday. */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay()
  return day === 0 || day === 6
}

/**
 * Returns dateStr if it's a working day, else the next working day.
 * `extraOff` is an optional set of additional yyyy-mm-dd days that count
 * as non-working (member-specific vacation).
 */
export function nextBusinessDay(
  dateStr: string,
  extraOff?: ReadonlySet<string>
): string {
  let d = dateStr
  while (isWeekend(d) || extraOff?.has(d)) d = addDays(d, 1)
  return d
}

/**
 * Add `n` working days to `dateStr`. Assumes dateStr is already a working
 * day. Sat/Sun and any day in `extraOff` do not consume `n`.
 */
export function addBusinessDays(
  dateStr: string,
  n: number,
  extraOff?: ReadonlySet<string>
): string {
  let d = dateStr
  let remaining = n
  while (remaining > 0) {
    d = addDays(d, 1)
    if (!isWeekend(d) && !extraOff?.has(d)) remaining--
  }
  return d
}

/**
 * Compute (start, end) for a task based on its prereqs and effort.
 * - If task has no prereqs: returns (task.startDate, task.dueDate) — manual.
 * - If prereqs exist: start = max(prereq.dueDate) + 1 day.
 * - end = start + (estimate - 1) days; if no estimate, end = start.
 * Returns null fields if the calculation can't run (e.g. no prereq has an end).
 */
/**
 * Working fraction contributed by a single day for the given off-map.
 * - Sat/Sun: 0
 * - In off-map with full off (no `half`): 0
 * - In off-map with `half`: 0.5
 * - Otherwise: 1
 */
export function workingFraction(
  date: string,
  contribByDate?: ReadonlyMap<string, 0 | 0.5>
): number {
  if (isWeekend(date)) return 0
  if (contribByDate?.has(date)) return contribByDate.get(date) as number
  return 1
}

const EPS = 1e-9

/**
 * Internal plan for a task — dates, plus the wall-clock fractions of the
 * start and end days needed to render times and chain to dependents.
 *
 * Wall-clock fraction model: 0 = 08:00, 0.5 = 12:00 (lunch / 13:00 resume),
 * 1 = 17:00. Lunch is treated as a non-counting break; work either fills
 * (0..0.5] AM or (0.5..1] PM.
 */
interface TaskPlan {
  startDate: string | null
  dueDate: string | null
  /** Wall fraction at which work begins on startDate (0=08:00, 0.5=13:00). */
  startOffset: number
  /** Wall fraction at which work ends on dueDate (0.5=12:00, 1=17:00). */
  dueFraction: number
}

function planFor(
  task: Task,
  byId: Map<string, Task>,
  memberById: Map<string, Member> | undefined,
  cache: Map<string, TaskPlan>
): TaskPlan {
  const hit = cache.get(task.id)
  if (hit) return hit

  const member = task.assigneeId ? memberById?.get(task.assigneeId) : undefined
  const halfByDate = new Map<string, 'am' | 'pm'>()
  const contribByDate = new Map<string, 0 | 0.5>()
  if (member?.daysOff) {
    for (const d of member.daysOff) {
      contribByDate.set(d.date, d.half ? 0.5 : 0)
      if (d.half) halfByDate.set(d.date, d.half)
    }
  }
  const dayContrib = (date: string): number => {
    if (isWeekend(date)) return 0
    if (contribByDate.has(date)) return contribByDate.get(date) as number
    return 1
  }
  // Wall position where work naturally begins on `date`. AM-off → 0.5.
  const naturalWallStart = (date: string): number =>
    dayContrib(date) === 0.5 && halfByDate.get(date) === 'am' ? 0.5 : 0
  // Wall position where work naturally ends on `date`. PM-off → 0.5.
  const naturalWallEnd = (date: string): number => {
    const c = dayContrib(date)
    if (c === 0) return 0
    if (c === 0.5 && halfByDate.get(date) === 'pm') return 0.5
    return 1
  }
  // Available work fraction on `date` given a wall-clock start offset.
  const availOnDay = (date: string, offset: number): number => {
    const ws = naturalWallStart(date)
    const we = naturalWallEnd(date)
    return Math.max(0, we - Math.max(offset, ws))
  }

  // Step 1: pick start. With prereqs, find the latest prereq end moment.
  let start: string | null = task.startDate
  let startOffset = 0
  if (task.dependsOn?.length > 0) {
    let bestDate: string | null = null
    let bestFrac = 0
    for (const id of task.dependsOn) {
      const p = byId.get(id)
      if (!p) continue
      const pPlan = planFor(p, byId, memberById, cache)
      if (!pPlan.dueDate) continue
      if (
        bestDate === null ||
        pPlan.dueDate > bestDate ||
        (pPlan.dueDate === bestDate && pPlan.dueFraction > bestFrac)
      ) {
        bestDate = pPlan.dueDate
        bestFrac = pPlan.dueFraction
      }
    }
    if (bestDate) {
      // Can the dependent start the same day with leftover capacity?
      // "Leftover" exists if this task's natural-end on bestDate extends
      // beyond the wall position where the prereq stopped working.
      if (naturalWallEnd(bestDate) > bestFrac + EPS) {
        start = bestDate
        startOffset = Math.max(naturalWallStart(bestDate), bestFrac)
      } else {
        let d = addDays(bestDate, 1)
        while (dayContrib(d) <= 0) d = addDays(d, 1)
        start = d
        startOffset = 0
      }
    }
  }

  if (!start) {
    const plan: TaskPlan = {
      startDate: null,
      dueDate: task.dueDate,
      startOffset: 0,
      dueFraction: 1,
    }
    cache.set(task.id, plan)
    return plan
  }

  // Step 2: normalize start past off days when caller set it on one.
  while (dayContrib(start) <= 0) {
    start = addDays(start, 1)
    startOffset = 0
  }
  // If the day naturally starts later (AM-off), lift offset to match.
  startOffset = Math.max(startOffset, naturalWallStart(start))

  // No effort → end stays manual.
  if (!task.estimate || task.estimate <= 0) {
    const plan: TaskPlan = {
      startDate: start,
      dueDate: task.dueDate,
      startOffset,
      dueFraction: 1,
    }
    cache.set(task.id, plan)
    return plan
  }

  // Step 3: walk forward consuming effort.
  let d = start
  let remaining = task.estimate
  let end = start
  let isFirst = true
  let lastUse = 0
  let lastWallStart = startOffset
  while (remaining > EPS) {
    const avail = isFirst ? availOnDay(d, startOffset) : availOnDay(d, 0)
    if (avail > 0) {
      const use = Math.min(remaining, avail)
      remaining -= use
      end = d
      lastUse = use
      lastWallStart = isFirst
        ? Math.max(naturalWallStart(d), startOffset)
        : naturalWallStart(d)
    }
    isFirst = false
    if (remaining > EPS) d = addDays(d, 1)
  }
  const dueFraction = Math.min(1, lastWallStart + lastUse)
  const plan: TaskPlan = { startDate: start, dueDate: end, startOffset, dueFraction }
  cache.set(task.id, plan)
  return plan
}

/**
 * The live display plan for a task: start/due DATES plus their wall-clock
 * TIMES, all from a single `planFor` pass. Use this for rendering so the
 * date and time always share one source and can never drift apart (e.g. a
 * stored `dueDate` going stale against a freshly-computed time). For tasks
 * with no effort/prereqs this returns the manual stored dates unchanged.
 *
 * Time mapping: fractions → {08:00, 12:00, 13:00, 17:00}. Sub-half-day usage
 * rounds to lunch (12:00) or 17:00.
 */
export function computeWorkingPlan(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startDate: string | null; dueDate: string | null; startTime: string; endTime: string } {
  const plan = planFor(task, byId, memberById, new Map())
  return {
    startDate: plan.startDate,
    dueDate: plan.dueDate,
    startTime: plan.startOffset >= 0.5 - EPS ? '13:00' : '08:00',
    endTime: plan.dueFraction > 0.5 + EPS ? '17:00' : '12:00',
  }
}

/**
 * Wall-clock display times. Maps the plan's fractions to {08:00, 12:00,
 * 13:00, 17:00}. Sub-half-day usage is rounded to lunch (12:00) or 17:00.
 */
export function computeWorkingTimes(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startTime: string; endTime: string } {
  const { startTime, endTime } = computeWorkingPlan(task, byId, memberById)
  return { startTime, endTime }
}

/**
 * Recompute a task's start/end from its prereqs, effort, and the assignee's
 * off-days.
 *
 * Rules:
 *   - If task has prereqs with end dates → start = next working day after
 *     latest prereq end. Otherwise start = task.startDate (manual).
 *   - If effort > 0 → end = start + effort working days, consuming
 *     half-off days as 0.5 and skipping weekends + full-off days.
 *     Otherwise end = task.dueDate (manual).
 *   - If start lands on a non-working day (weekend or full-off), it's
 *     pushed forward to the next working day.
 *
 * Returns task.startDate / task.dueDate unchanged when there's nothing to
 * compute (no prereqs AND no effort).
 */
export function computeStartEnd(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): { startDate: string | null; dueDate: string | null } {
  const plan = planFor(task, byId, memberById, new Map())
  return { startDate: plan.startDate, dueDate: plan.dueDate }
}

/**
 * Recompute dates for `taskId` and walk forward to any tasks that depend on
 * it. Idempotent — stops when a task's computed dates equal current ones.
 */
export async function recomputeDates(taskId: string): Promise<void> {
  await db.transaction('rw', db.tasks, db.members, async () => {
    const members = await db.members.toArray()
    const memberById = new Map(members.map((m) => [m.id, m]))
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
      const next = computeStartEnd(task, byId, memberById)
      if (
        next.startDate !== task.startDate ||
        next.dueDate !== task.dueDate
      ) {
        await db.tasks.update(id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
      }
      for (const t of all) {
        if (t.dependsOn?.includes(id) && !visited.has(t.id)) {
          queue.push(t.id)
        }
      }
    }
  })
}

/**
 * Recompute and persist start/due for EVERY task in the DB, healing stored
 * dates that drifted out of sync — e.g. a dueDate computed under an older
 * off-day state whose recompute was never re-triggered. `planFor` derives
 * computed tasks from scratch (it never trusts the stored dueDate), so the
 * pass is order-independent and only writes rows whose result actually
 * changed. Idempotent and cheap; safe to run once on app load. Returns the
 * number of tasks updated.
 */
export async function recomputeAllDates(): Promise<number> {
  return db.transaction('rw', db.tasks, db.members, async () => {
    const members = await db.members.toArray()
    const memberById = new Map(members.map((m) => [m.id, m]))
    const all = await db.tasks.toArray()
    const byId = new Map(all.map((t) => [t.id, t]))
    let changed = 0
    for (const task of all) {
      const next = computeStartEnd(task, byId, memberById)
      if (next.startDate !== task.startDate || next.dueDate !== task.dueDate) {
        await db.tasks.update(task.id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
        changed++
      }
    }
    return changed
  })
}

/**
 * Replace a member's vacation days. Sorts + dedupes + filters invalid dates,
 * then recomputes every task assigned to that member (forward through their
 * dependents too).
 */
/**
 * Move every not-done task in `sourceSprintId` to the next sprint
 * (chronologically — the smallest startDate greater than source's).
 *
 * Returns `{ movedCount, targetSprintId }`. Returns null target if there
 * is no next sprint.
 *
 * Behavior:
 * - Done tasks stay put.
 * - Moved tasks get the new sprintId. If their startDate is now before
 *   the target sprint's start, it's bumped to the target start. Dates
 *   are then recomputed (effort + off-days + prereq chain still apply).
 * - dependsOn links survive across sprints — prereq IDs stay valid.
 */
export async function moveUnfinishedToNextSprint(
  sourceSprintId: string
): Promise<{ movedCount: number; targetSprintId: string | null }> {
  const sprints = await db.sprints.orderBy('startDate').toArray()
  const sourceIdx = sprints.findIndex((s) => s.id === sourceSprintId)
  if (sourceIdx === -1) return { movedCount: 0, targetSprintId: null }
  const target = sprints[sourceIdx + 1]
  if (!target) return { movedCount: 0, targetSprintId: null }

  const unfinished = await db.tasks
    .where('sprintId')
    .equals(sourceSprintId)
    .filter((t) => t.status !== 'done')
    .toArray()

  for (const t of unfinished) {
    // Sequence is per-sprint, so a moved task must be renumbered into the
    // target — otherwise it keeps its source number and collides with an
    // existing task there. Awaited in-loop so each call sees the prior insert.
    const patch: Partial<Task> = {
      sprintId: target.id,
      sequence: await nextSequence(target.id),
    }
    // Pull stale starts forward so the task lands inside the new sprint.
    if (!t.startDate || t.startDate < target.startDate) {
      patch.startDate = target.startDate
    }
    await db.tasks.update(t.id, patch)
  }
  // Recompute after the bulk move so prereq chains settle in their new
  // home (and assignee off-days reapply).
  for (const t of unfinished) await recomputeDates(t.id)

  return { movedCount: unfinished.length, targetSprintId: target.id }
}

export async function setMemberDaysOff(
  memberId: string,
  daysOff: DayOff[]
): Promise<DayOff[]> {
  // Dedupe by date (last entry wins), drop bad dates, sort.
  const byDate = new Map<string, DayOff>()
  for (const d of daysOff) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue
    byDate.set(d.date, d.half ? { date: d.date, half: d.half } : { date: d.date })
  }
  const clean = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  )
  await db.members.update(memberId, { daysOff: clean })
  const owned = await db.tasks.where('assigneeId').equals(memberId).toArray()
  for (const t of owned) await recomputeDates(t.id)
  return clean
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
  version: 1 | 2
  exportedAt: string
  /** v2 introduces multi-project. v1 payloads have no `projects` field. */
  projects?: Project[]
  members: Member[]
  sprints: Sprint[]
  tasks: Task[]
}

export async function exportAll(): Promise<ExportPayload> {
  const [projects, members, sprints, tasks] = await Promise.all([
    db.projects.toArray(),
    db.members.toArray(),
    db.sprints.toArray(),
    db.tasks.toArray(),
  ])
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    projects,
    members,
    sprints,
    tasks,
  }
}

export async function importAll(data: ExportPayload) {
  if (!data || (data.version !== 1 && data.version !== 2)) {
    throw new Error('Unsupported export version')
  }
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
    async () => {
      await db.tasks.clear()
      await db.sprints.clear()
      await db.members.clear()
      await db.projects.clear()
      // v1 payloads predate multi-project — synthesize a default project
      // and stamp it onto every row.
      let projects: Project[]
      let defaultId: string | null = null
      if (data.version === 2 && data.projects && data.projects.length > 0) {
        projects = data.projects
      } else {
        defaultId = uid()
        projects = [
          { id: defaultId, name: 'My Project', createdAt: Date.now() },
        ]
      }
      await db.projects.bulkAdd(projects)
      const fallbackId = defaultId ?? projects[0].id
      const pidOf = (row: { projectId?: string }) => row.projectId ?? fallbackId

      const members: Member[] = data.members.map((m) => {
        const raw = (m.daysOff ?? []) as Array<string | DayOff>
        const daysOff: DayOff[] = raw.map((d) =>
          typeof d === 'string' ? { date: d } : d
        )
        return { ...m, projectId: pidOf(m), daysOff }
      })
      await db.members.bulkAdd(members)

      const sprints: Sprint[] = data.sprints.map((s) => ({
        ...s,
        projectId: pidOf(s),
      }))
      await db.sprints.bulkAdd(sprints)

      // Sequence backfill is per-project for v1 payloads.
      const seqCounter = new Map<string, number>()
      const sorted = [...data.tasks].sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
      )
      const tasks: Task[] = sorted.map((t) => {
        const pid = pidOf(t)
        let seq: number
        if (typeof t.sequence === 'number') {
          seq = t.sequence
        } else {
          const cur = seqCounter.get(pid) ?? 0
          seq = cur + 1
          seqCounter.set(pid, seq)
        }
        return {
          ...t,
          projectId: pid,
          startDate: t.startDate ?? null,
          dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
          sequence: seq,
        }
      })
      await db.tasks.bulkAdd(tasks)
    }
  )
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

    // Scope by (projectId, name) — same name across projects is NOT a
    // duplicate. (Pre-v7 single-project bucketed by name alone, which
    // accidentally merged cross-project sprints once multi-project shipped.)
    const byName = new Map<string, Sprint[]>()
    for (const s of sprints) {
      const key = `${s.projectId}::${s.name}`
      const bucket = byName.get(key) ?? []
      bucket.push(s)
      byName.set(key, bucket)
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
        // Renumber as we move — sequence is per-sprint, so a plain sprintId
        // swap would carry the dup's numbers over and collide with the keeper's.
        const dupTasks = await db.tasks.where('sprintId').equals(dup.id).toArray()
        for (const t of dupTasks) {
          await db.tasks.update(t.id, {
            sprintId: keeper.id,
            sequence: await nextSequence(keeper.id),
          })
        }
        await db.sprints.delete(dup.id)
        removed++
      }
    }
    return removed
  })
}

async function doSeed() {
  await db.transaction(
    'rw',
    db.projects,
    db.members,
    db.sprints,
    db.tasks,
    async () => {
      // Ensure at least one project exists (the migration creates one for
      // upgrading users; first-launch needs us to handle it here too).
      let project = (await db.projects.toArray())[0]
      if (!project) {
        project = {
          id: uid(),
          name: 'My Project',
          createdAt: Date.now(),
        }
        await db.projects.add(project)
      }
      const memberCount = await db.members.count()
      if (memberCount > 0) return
      await seedFresh(project.id)
    }
  )
}

async function seedFresh(projectId: string) {
  const names = ['Alice', 'Bob', 'Charlie']
  const members: Member[] = names.map((name) => ({
    id: uid(),
    projectId,
    name,
    color: colorForName(name),
    daysOff: [],
  }))
  await db.members.bulkAdd(members)

  const today = new Date()
  const end = new Date(today)
  end.setDate(end.getDate() + 13)
  const sprint: Sprint = {
    id: uid(),
    projectId,
    name: 'Sprint 1',
    startDate: today.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
  await db.sprints.add(sprint)

  await db.tasks.add({
    id: uid(),
    projectId,
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
