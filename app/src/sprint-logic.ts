import {
  computeWorkingPlan,
  type Member,
  type Task,
  type Status,
} from './db'

// Pure sprint-view logic shared by the List (SprintView), Board and Gantt
// views — kept out of the component files so Vite fast-refresh stays whole-
// component and tests import no JSX.

export const STATUS_META: Record<Status, { label: string; varName: string }> = {
  todo: { label: 'To do', varName: 'var(--color-status-todo)' },
  in_progress: { label: 'In progress', varName: 'var(--color-status-progress)' },
  done: { label: 'Done', varName: 'var(--color-status-done)' },
}

export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done']

/**
 * Detect schedule conflicts among one member's leaf tasks. A pair conflicts if
 * their computed [start … end] intervals OVERLAP (one person can't run two tasks
 * at once), or they share a prerequisite. Same-start / same-end are kept only as a
 * fallback for zero-duration tasks (where a strict overlap is empty). Returns a
 * per-task tooltip string (absent = no conflict). O(n²) over a member's tasks
 * (small). See design-docs/conflict-warning.md.
 */
export function computeMemberConflicts(
  tasks: Task[],
  tasksById: Map<string, Task>,
  memberById: Map<string, Member>
): Map<string, string> {
  type Hit = { seq: number; kind: 'overlap' | 'start' | 'end' | 'prereq' }
  // Unsized tasks (no effort) aren't really scheduled — exclude them from
  // double-booking detection. See design-docs/conflict-warning.md.
  const sized = tasks.filter((t) => t.estimate !== null)
  const plans = new Map(
    sized.map((t) => [t.id, computeWorkingPlan(t, tasksById, memberById)])
  )
  const startKey = (t: Task) => {
    const p = plans.get(t.id)!
    return p.startDate ? `${p.startDate}T${p.startTime ?? ''}` : null
  }
  const endKey = (t: Task) => {
    const p = plans.get(t.id)!
    return p.dueDate ? `${p.dueDate}T${p.endTime ?? ''}` : null
  }
  const hits = new Map<string, Hit[]>()
  const push = (id: string, h: Hit) => {
    const a = hits.get(id) ?? []
    a.push(h)
    hits.set(id, a)
  }
  for (let i = 0; i < sized.length; i++) {
    for (let j = i + 1; j < sized.length; j++) {
      const a = sized[i]
      const b = sized[j]
      const sa = startKey(a)
      const ea = endKey(a)
      const sb = startKey(b)
      const eb = endKey(b)
      // Time-range overlap: both tasks have a full [start..end] range and the
      // intervals strictly intersect (touching endpoints, e.g. back-to-back, don't
      // count). Keys are sortable ISO datetimes, so string `<` compares chronology.
      const overlap = sa && ea && sb && eb && sa < eb && sb < ea
      if (overlap) {
        push(a.id, { seq: b.sequence, kind: 'overlap' })
        push(b.id, { seq: a.sequence, kind: 'overlap' })
      } else {
        // Fallback for zero-duration tasks (strict overlap is empty): exact endpoint match.
        if (sa && sa === sb) {
          push(a.id, { seq: b.sequence, kind: 'start' })
          push(b.id, { seq: a.sequence, kind: 'start' })
        }
        if (ea && ea === eb) {
          push(a.id, { seq: b.sequence, kind: 'end' })
          push(b.id, { seq: a.sequence, kind: 'end' })
        }
      }
      if (a.dependsOn.some((d) => b.dependsOn.includes(d))) {
        push(a.id, { seq: b.sequence, kind: 'prereq' })
        push(b.id, { seq: a.sequence, kind: 'prereq' })
      }
    }
  }
  const label = (k: Hit['kind']) =>
    k === 'overlap'
      ? 'chồng thời gian'
      : k === 'start'
        ? 'giờ bắt đầu'
        : k === 'end'
          ? 'giờ kết thúc'
          : 'chung prereq'
  const tips = new Map<string, string>()
  for (const [id, list] of hits) {
    const byOther = new Map<number, Set<string>>()
    for (const h of list) {
      const s = byOther.get(h.seq) ?? new Set<string>()
      s.add(label(h.kind))
      byOther.set(h.seq, s)
    }
    const parts = [...byOther.entries()].map(
      ([seq, kinds]) => `#${seq} (${[...kinds].join(', ')})`
    )
    tips.set(id, `Trùng lịch với ${parts.join('; ')}`)
  }
  return tips
}

/** Roll-up status of a parent task derived from its children (display only). */
export function derivedGroupStatus(children: Task[]): Status {
  if (children.length === 0) return 'todo'
  if (children.every((c) => c.status === 'done')) return 'done'
  if (children.some((c) => c.status === 'in_progress' || c.status === 'done'))
    return 'in_progress'
  return 'todo'
}
