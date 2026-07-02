import type { ActivityEvent, ChangeLogEntry, Sprint, Task } from './types'
import { db, uid } from './schema'

/** Window in which consecutive TITLE keystrokes collapse into one event. */
const TITLE_COALESCE_MS = 2 * 60 * 1000

// ──────────────────────────────────────────────────────────────────────────
// Sprint activity log (design-docs/sprint-activity-log.md, storage model A).
// Append-only `events` store written from user-edit write sites. Scheduler
// recomputes (raw db.tasks.update) are never logged — premise #2. Collection
// tasks (no sprintId) are never logged.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-sprint cap on the activity store: only the newest N events of each sprint
 * are kept; older ones are pruned on write. Bounds unbounded growth (the log is
 * a recent-history surface, not permanent audit). See sprint-activity-log.md.
 */
export const MAX_EVENTS_PER_SPRINT = 500

/**
 * Trim a sprint's events to the newest MAX_EVENTS_PER_SPRINT rows. No-op when
 * under the cap. Must run inside an rw transaction whose scope includes
 * db.events (every caller already holds one).
 */
async function pruneSprintEvents(sprintId: string): Promise<void> {
  const rows = await db.events.where('sprintId').equals(sprintId).toArray()
  if (rows.length <= MAX_EVENTS_PER_SPRINT) return
  // newest-first, then drop everything past the cap (the oldest).
  rows.sort((a, b) => b.ts - a.ts)
  await db.events.bulkDelete(rows.slice(MAX_EVENTS_PER_SPRINT).map((e) => e.id))
}

/** Append one activity event (id auto-assigned), then prune the sprint to the cap. */
export async function logEvent(e: Omit<ActivityEvent, 'id'>): Promise<void> {
  await db.events.add({ id: uid(), ...e })
  await pruneSprintEvents(e.sprintId)
}

/**
 * Canonical sprint creation: the row and its `sprint_started` activity event
 * commit in ONE transaction — a crash between them can't leave a sprint with
 * no birth entry. Every creation path goes through here (the New Sprint
 * dialog; seeding logs no event by design).
 */
export async function createSprint(sprint: Sprint): Promise<Sprint> {
  await db.transaction('rw', db.sprints, db.events, async () => {
    await db.sprints.add(sprint)
    await logEvent({
      projectId: sprint.projectId,
      sprintId: sprint.id,
      taskId: null,
      taskSeq: null,
      taskTitle: null,
      kind: 'sprint_started',
      from: null,
      to: null,
      ts: Date.now(),
    })
  })
  return sprint
}

/** A sprint's activity, newest-first (ts desc). */
export async function sprintEvents(sprintId: string): Promise<ActivityEvent[]> {
  const rows = await db.events.where('sprintId').equals(sprintId).toArray()
  return rows.sort((a, b) => b.ts - a.ts)
}

/**
 * Mirror the just-built changeLog `entries` into the activity store. Sprint-only.
 * `title` coalesces within TITLE_COALESCE_MS (like the changeLog) so a keystroke
 * burst is one event, not one per character. MUST run inside a transaction whose
 * scope includes db.events. Display fields are frozen at write time.
 */
export async function logTaskEdits(task: Task, entries: ChangeLogEntry[]): Promise<void> {
  if (!task.sprintId) return
  for (const e of entries) {
    if (e.field === 'title') {
      const prior = (await db.events.where('sprintId').equals(task.sprintId).toArray())
        .filter((ev) => ev.taskId === task.id && ev.kind === 'edit' && ev.field === 'title')
        .sort((a, b) => b.ts - a.ts)[0]
      if (prior && e.ts - prior.ts <= TITLE_COALESCE_MS) {
        await db.events.update(prior.id, { to: e.to, ts: e.ts })
        continue
      }
    }
    await db.events.add({
      id: uid(),
      projectId: task.projectId,
      sprintId: task.sprintId,
      taskId: task.id,
      taskSeq: task.sequence ?? null,
      taskTitle: task.title,
      kind: 'edit',
      field: e.field,
      from: e.from,
      to: e.to,
      ts: e.ts,
    })
  }
  await pruneSprintEvents(task.sprintId)
}
