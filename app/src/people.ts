import type { Member, Task, Person } from './db'

// Cross-project People identity — pure helpers shared by the v13 migration
// (buildPersonBackfill) and HomeDashboard (load/spread/days-off).
// See design-docs/home-dashboard.md.

/** Normalize a member name for identity matching: trimmed, lower-cased. */
export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Group members by normalized name across ALL projects → one Person each.
 * The first member of each group seeds the person's display name + color
 * (falling back to `colorFor(name)` when the member has no color). Returns the
 * new people and the member→person links to apply. Pure; the v13 upgrade and
 * any re-link path call this.
 */
export function buildPersonBackfill(
  members: Member[],
  makeId: () => string,
  colorFor: (name: string) => string,
  now: number
): { people: Person[]; links: Array<{ memberId: string; personId: string }> } {
  const people: Person[] = []
  const links: Array<{ memberId: string; personId: string }> = []
  const byName = new Map<string, string>() // normalized name → personId
  for (const m of members) {
    const key = normalizePersonName(m.name)
    let pid = byName.get(key)
    if (!pid) {
      pid = makeId()
      byName.set(key, pid)
      people.push({
        id: pid,
        name: m.name.trim(),
        color: m.color || colorFor(m.name),
        createdAt: now,
      })
    }
    links.push({ memberId: m.id, personId: pid })
  }
  return { people, links }
}

/**
 * Combined load for a person across all projects: count + summed effort
 * (`estimate ?? 0`) of NON-DONE LEAF tasks assigned to any of the person's
 * members. Parents (a task that is some task's parentId) are excluded so a
 * group isn't double-counted with its children.
 */
export function personLoad(
  memberIds: ReadonlySet<string>,
  tasks: Task[]
): { taskCount: number; effort: number } {
  const parentIds = new Set<string>()
  for (const t of tasks) if (t.parentId) parentIds.add(t.parentId)
  let taskCount = 0
  let effort = 0
  for (const t of tasks) {
    if (parentIds.has(t.id)) continue // not a leaf
    if (t.status === 'done') continue
    if (t.assigneeId == null || !memberIds.has(t.assigneeId)) continue
    taskCount++
    effort += t.estimate ?? 0
  }
  return { taskCount, effort }
}

/**
 * Whether a task is overdue: not done, and past its date. A milestone
 * (`estimate === 0`) keeps its date on `startDate`; every other task uses
 * `dueDate`. Mirrors SprintView's milestone overdue rule so the Home overdue
 * chip and the sprint view agree. See design-docs/home-dashboard.md.
 */
export function taskOverdue(task: Task, todayISO: string): boolean {
  if (task.status === 'done') return false
  const date = task.estimate === 0 ? task.startDate : task.dueDate
  return date != null && date < todayISO
}

/** Distinct projects a person appears in (member rows span projects). */
export function personProjectCount(members: Member[]): number {
  return new Set(members.map((m) => m.projectId)).size
}

/**
 * Soonest upcoming off-day (yyyy-mm-dd ≥ today), unioned + deduped across all
 * of a person's members. Null when none upcoming. ISO dates sort lexically.
 */
export function nextDayOff(members: Member[], todayISO: string): string | null {
  const dates = new Set<string>()
  for (const m of members) for (const d of m.daysOff) dates.add(d.date)
  let best: string | null = null
  for (const d of dates) {
    if (d < todayISO) continue
    if (best === null || d < best) best = d
  }
  return best
}
