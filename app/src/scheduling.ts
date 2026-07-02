import type { Member, Task } from './types'
import { db } from './schema'

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

type PlanCtx = { children: Map<string, string[]>; inProgress: Set<string> }
const NULL_PLAN: TaskPlan = { startDate: null, dueDate: null, startOffset: 0, dueFraction: 1 }

/** parentId → child ids (only children whose parent exists in the map). */
function childrenByParent(byId: Map<string, Task>): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const t of byId.values()) {
    if (t.parentId && byId.has(t.parentId)) {
      const a = m.get(t.parentId)
      if (a) a.push(t.id)
      else m.set(t.parentId, [t.id])
    }
  }
  return m
}

/**
 * Memoized plan with a cycle guard + parent roll-up. A task that HAS children is
 * scheduled as the SPAN of its children (earliest child start → latest child
 * end+fraction) — which is also what lets a group act as a prereq anchor. Leaf
 * tasks go through `leafPlan`. The `inProgress` set breaks any cycle introduced
 * via group membership (returns NULL_PLAN instead of recursing forever).
 * See design-docs/scheduling.md + task-groups.md.
 */
function planFor(
  task: Task,
  byId: Map<string, Task>,
  memberById: Map<string, Member> | undefined,
  cache: Map<string, TaskPlan>,
  ctx?: PlanCtx
): TaskPlan {
  const c = ctx ?? { children: childrenByParent(byId), inProgress: new Set<string>() }
  const cached = cache.get(task.id)
  if (cached) return cached
  if (c.inProgress.has(task.id)) return NULL_PLAN
  c.inProgress.add(task.id)
  let plan: TaskPlan
  const kids = c.children.get(task.id)
  if (kids && kids.length) {
    // Parent: roll up the children's span. Own estimate/start/deps are ignored.
    let minStart: string | null = null
    let bestEnd: string | null = null
    let bestFrac = 0
    for (const cid of kids) {
      const child = byId.get(cid)
      if (!child) continue
      const cp = planFor(child, byId, memberById, cache, c)
      if (cp.startDate && (minStart === null || cp.startDate < minStart)) minStart = cp.startDate
      if (
        cp.dueDate &&
        (bestEnd === null ||
          cp.dueDate > bestEnd ||
          (cp.dueDate === bestEnd && cp.dueFraction > bestFrac))
      ) {
        bestEnd = cp.dueDate
        bestFrac = cp.dueFraction
      }
    }
    plan = { startDate: minStart, dueDate: bestEnd, startOffset: 0, dueFraction: bestEnd ? bestFrac : 1 }
  } else {
    plan = leafPlan(task, byId, memberById, cache, c)
  }
  c.inProgress.delete(task.id)
  cache.set(task.id, plan)
  return plan
}

/** Schedule a LEAF task (no children): manual/prereq start + effort walk. */
function leafPlan(
  task: Task,
  byId: Map<string, Task>,
  memberById: Map<string, Member> | undefined,
  cache: Map<string, TaskPlan>,
  ctx: PlanCtx
): TaskPlan {
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
    // The start is PURELY prereq-derived when prereqs exist (the cell is locked
    // in the UI). Don't seed it with the stored value — that's a leftover from a
    // PREVIOUS prereq, and would linger if the new prereq can't anchor a date
    // (e.g. you re-link to an unscheduled task). Until a prereq has a due date,
    // there's no anchor → start clears. See design-docs/scheduling.md.
    start = null
    let bestDate: string | null = null
    let bestFrac = 0
    for (const id of task.dependsOn) {
      const p = byId.get(id)
      if (!p) continue
      const pPlan = planFor(p, byId, memberById, cache, ctx)
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
    return { startDate: null, dueDate: task.dueDate, startOffset: 0, dueFraction: 1 }
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
    return { startDate: start, dueDate: task.dueDate, startOffset, dueFraction: 1 }
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
  return { startDate: start, dueDate: end, startOffset, dueFraction }
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
export interface WorkingPlan {
  startDate: string | null
  dueDate: string | null
  startTime: string
  endTime: string
}

export function computeWorkingPlan(
  task: Task,
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): WorkingPlan {
  const plan = planFor(task, byId, memberById, new Map())
  return {
    startDate: plan.startDate,
    dueDate: plan.dueDate,
    startTime: plan.startOffset >= 0.5 - EPS ? '13:00' : '08:00',
    endTime: plan.dueFraction > 0.5 + EPS ? '17:00' : '12:00',
  }
}

/**
 * Working plans for EVERY task in one pass, sharing a single memo cache and
 * children map across the whole set. `computeWorkingPlan` re-derives each
 * task's prereq/group chain from scratch — fine for one cell, quadratic when
 * a view calls it per row. Views compute this once per data change instead.
 */
export function computeAllWorkingPlans(
  tasks: Task[],
  byId: Map<string, Task>,
  memberById?: Map<string, Member>
): Map<string, WorkingPlan> {
  const cache = new Map<string, TaskPlan>()
  const ctx = { children: childrenByParent(byId), inProgress: new Set<string>() }
  const out = new Map<string, WorkingPlan>()
  for (const t of tasks) {
    const plan = planFor(t, byId, memberById, cache, ctx)
    out.set(t.id, {
      startDate: plan.startDate,
      dueDate: plan.dueDate,
      startTime: plan.startOffset >= 0.5 - EPS ? '13:00' : '08:00',
      endTime: plan.dueFraction > 0.5 + EPS ? '17:00' : '12:00',
    })
  }
  return out
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
    // Read the table ONCE. The dependency graph (`dependsOn`) never changes
    // during a recompute — only dates do — so we keep `byId` fresh in-memory
    // after each write instead of re-materialising the whole table every queue
    // step (which was O(chain × N) full-table reads inside one transaction).
    const all = await db.tasks.toArray()
    const byId = new Map(all.map((t) => [t.id, t]))
    const visited = new Set<string>()
    const queue: string[] = [taskId]
    while (queue.length) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const task = byId.get(id)
      if (!task) continue
      const next = computeStartEnd(task, byId, memberById)
      if (
        next.startDate !== task.startDate ||
        next.dueDate !== task.dueDate
      ) {
        // Keep the in-memory snapshot current so dependents downstream in this
        // same walk compute against the freshly-written dates.
        byId.set(id, { ...task, startDate: next.startDate, dueDate: next.dueDate })
        await db.tasks.update(id, {
          startDate: next.startDate,
          dueDate: next.dueDate,
        })
      }
      // Re-flow dependents of this task — and, if it's a group child, dependents
      // of its PARENT too (the group's rolled-up end shifts when a child does, so
      // anything depending on the group must recompute). See task-groups.md.
      const parentId = task.parentId
      for (const t of all) {
        if (visited.has(t.id)) continue
        if (
          t.dependsOn?.includes(id) ||
          (parentId && t.dependsOn?.includes(parentId))
        ) {
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
  // Depending on a group means depending on all its children, so treat
  // `parent → children` as edges too. See design-docs/task-groups.md.
  const kidsOf = childrenByParent(byId)
  const stack = [newDepId]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === taskId) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    const t = byId.get(cur)
    if (t) stack.push(...t.dependsOn)
    const kids = kidsOf.get(cur)
    if (kids) stack.push(...kids)
  }
  return false
}

/**
 * If adding `newDepId` as a prerequisite of `taskId` would create a cycle,
 * return the existing path of task IDs from `newDepId` back to `taskId`
 * (shortest, via BFS over `dependsOn`). The full loop is then
 * `taskId → newDepId → …returned… (ends at taskId)`. Returns null when no such
 * path exists (i.e. no cycle). Companion to `wouldCreateCycle` that also yields
 * the path so the UI can show *where* the loop runs.
 */
export function findCyclePath(
  taskId: string,
  newDepId: string,
  tasks: Task[]
): string[] | null {
  if (taskId === newDepId) return [newDepId]
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const kidsOf = childrenByParent(byId)
  const parent = new Map<string, string | null>([[newDepId, null]])
  const queue = [newDepId]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === taskId) {
      const path: string[] = []
      let n: string | null = cur
      while (n != null) {
        path.unshift(n)
        n = parent.get(n) ?? null
      }
      return path
    }
    const t = byId.get(cur)
    // `parent → children` are edges too (depending on a group ⇒ on its children).
    const next = [...(t?.dependsOn ?? []), ...(kidsOf.get(cur) ?? [])]
    for (const d of next) {
      if (!parent.has(d)) {
        parent.set(d, cur)
        queue.push(d)
      }
    }
  }
  return null
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
    if (!dep) return false
    // A group (parent) prereq is "done" only when EVERY child is done — its own
    // stored status is derived/ignored. See design-docs/task-groups.md.
    const kids: Task[] = []
    for (const t of byId.values()) if (t.parentId === id) kids.push(t)
    if (kids.length) return !kids.every((k) => k.status === 'done')
    return dep.status !== 'done'
  })
}
