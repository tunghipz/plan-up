import type { Status, Task } from './types'
import type { WorkingPlan } from './scheduling'

/**
 * The List view's task-ordering machinery, lifted out of SprintView so other
 * surfaces (PNG export) can reproduce the *exact* on-screen order — the sort
 * field/direction, the computed-date sort keys, and the manual `listOrder`
 * fallback. No React, no Dexie: safe to import from pure modules and tests.
 * See design-docs/list-view.md.
 */

export type SortField =
  | 'seq'
  | 'title'
  | 'effort'
  | 'startDate'
  | 'dueDate'
  | 'status'
  | 'dependsOn'

const STATUS_RANK: Record<Status, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
}

/** Composite `date+time` sort keys per task id, mirroring what Start/End cells render. */
export type DateSortKeys = Map<string, { startDate: string; dueDate: string }>
const EMPTY_DATE_KEY = '￿' // no date → sorts last ascending (matches the raw-field sentinel)

/**
 * Build the Start/End sort keys that MATCH the displayed cells. A leaf row shows its
 * *scheduled* plan date, and a group-head row shows a rollup (earliest child start …
 * latest child end) that its own stored `startDate`/`dueDate` never tracks — so sorting
 * by the raw field puts parents out of order (usually last, since a parent's raw dueDate
 * is empty). Computed per lane (the array being sorted) so the rollup considers exactly
 * the children nested under the parent in that card. See design-docs/list-view.md.
 */
export function buildDateSortKeys(
  lane: Task[],
  planById: Map<string, WorkingPlan>
): DateSortKeys {
  const idSet = new Set(lane.map((t) => t.id))
  const kidsByParent = new Map<string, Task[]>()
  for (const t of lane) {
    if (t.parentId && idSet.has(t.parentId)) {
      const arr = kidsByParent.get(t.parentId) ?? []
      arr.push(t)
      kidsByParent.set(t.parentId, arr)
    }
  }
  const keys: DateSortKeys = new Map()
  for (const t of lane) {
    const kids = kidsByParent.get(t.id)
    if (kids?.length) {
      // Group head: min child start … max child end (same as the TaskGroupRow cell).
      let minStart: string | null = null
      let maxDue: string | null = null
      for (const c of kids) {
        const plan = planById.get(c.id)
        if (plan?.startDate) {
          const k = `${plan.startDate}T${plan.startTime ?? ''}`
          if (!minStart || k < minStart) minStart = k
        }
        if (plan?.dueDate) {
          const k = `${plan.dueDate}T${plan.endTime ?? ''}`
          if (!maxDue || k > maxDue) maxDue = k
        }
      }
      keys.set(t.id, {
        startDate: minStart ?? EMPTY_DATE_KEY,
        dueDate: maxDue ?? EMPTY_DATE_KEY,
      })
    } else {
      const plan = planById.get(t.id)
      keys.set(t.id, {
        startDate: plan?.startDate
          ? `${plan.startDate}T${plan.startTime ?? ''}`
          : EMPTY_DATE_KEY,
        dueDate: plan?.dueDate
          ? `${plan.dueDate}T${plan.endTime ?? ''}`
          : EMPTY_DATE_KEY,
      })
    }
  }
  return keys
}

export function compareTasks(
  a: Task,
  b: Task,
  field: SortField,
  dir: 'asc' | 'desc',
  dateKeys?: DateSortKeys
): number {
  const mul = dir === 'asc' ? 1 : -1
  const valueOf = (t: Task): string | number =>
    field === 'seq'
      ? (t.listOrder ?? t.sequence)
      : field === 'title'
        ? (t.title || '').toLowerCase()
        : field === 'effort'
          ? (t.estimate ?? Number.POSITIVE_INFINITY)
          : field === 'status'
            ? STATUS_RANK[t.status]
            : field === 'dependsOn'
              ? (t.dependsOn?.length ?? 0)
              : field === 'startDate' || field === 'dueDate'
                ? // Sort by the displayed computed/rollup date, not the raw field.
                  (dateKeys?.get(t.id)?.[field] ?? t[field] ?? '￿')
                : (t[field] ?? '￿')
  const va = valueOf(a)
  const vb = valueOf(b)
  if (va < vb) return -1 * mul
  if (va > vb) return 1 * mul
  return a.sequence - b.sequence // stable tiebreak by seq
}

// One global sort preference (shared across all member cards, not per-sprint), so it
// survives switching view/sprint/project and a page reload. See list-view.md.
export const SORT_KEY = 'plan-up:sort'

// `field: null` is the NEUTRAL state — no column sorted, rows fall back to the
// manual order (listOrder ?? sequence) and no header shows an arrow. It's the
// third stop in every column's asc → desc → off cycle. Keeping it distinct from
// `seq asc` is what lets the ID/seq column clear its arrow too. See list-view.md.
export type Sort = { field: SortField | null; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { field: null, dir: 'asc' }
export const SORT_FIELDS: SortField[] = [
  'seq',
  'title',
  'effort',
  'startDate',
  'dueDate',
  'status',
  'dependsOn',
]

export function loadSort(): Sort {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    if (!raw) return DEFAULT_SORT
    const parsed = JSON.parse(raw) as Partial<Sort>
    // Persisted neutral state (no field) restores as-is.
    if (parsed && parsed.field == null) return DEFAULT_SORT
    // Legacy migration: before the neutral state existed, `seq asc` WAS the
    // default/off state. It renders identically to neutral (manual order), so
    // map an old persisted `seq asc` onto neutral — otherwise an upgrading user
    // keeps seeing the ID column stuck with an arrow. An explicit `seq desc` is
    // a real choice → kept.
    if (parsed && parsed.field === 'seq' && parsed.dir === 'asc') return DEFAULT_SORT
    if (
      parsed &&
      SORT_FIELDS.includes(parsed.field as SortField) &&
      (parsed.dir === 'asc' || parsed.dir === 'desc')
    ) {
      return { field: parsed.field as SortField, dir: parsed.dir }
    }
    return DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

export function saveSort(sort: Sort) {
  try {
    localStorage.setItem(SORT_KEY, JSON.stringify(sort))
  } catch {
    // localStorage unavailable, swallow
  }
}

/**
 * Pull every dependent to sit **immediately after its prerequisite**, keeping
 * the incoming order otherwise. Runs AFTER the column sort.
 *
 * Writing `listOrder` when a prereq is saved only fixes the manual order — turn
 * a sort column on and the dependent drifts back to wherever its End/Status
 * puts it, which for an unscheduled dependent (empty End) is the bottom of the
 * lane: precisely the stranding the auto-move exists to prevent. So the pairing
 * is re-applied at display time, in every sort.
 *
 * This is the contract group children already have — `flattenDisplayOrder` and
 * `TaskTable` nest a child under its parent whatever the sort — so the List has
 * one rule, not two.
 *
 * Scope: only a prereq inside the SAME lane and the same group (`parentId`)
 * anchors anything; pulling across scopes would silently re-parent a row. With
 * several prereqs the anchor is the one sitting LOWEST here, so the dependent
 * lands below all of them. See design-docs/dependencies.md.
 */
export function pullDependentsUnderPrereqs(lane: Task[]): Task[] {
  if (lane.length < 2) return lane
  const pos = new Map<string, number>()
  lane.forEach((t, i) => pos.set(t.id, i))
  const scope = (t: Task) => t.parentId ?? null

  const anchorOf = (t: Task): string | null => {
    let best: string | null = null
    let bestPos = -1
    for (const id of t.dependsOn ?? []) {
      const p = pos.get(id)
      if (p === undefined) continue // prereq lives in another lane
      if (scope(lane[p]) !== scope(t)) continue // another group
      if (p > bestPos) {
        bestPos = p
        best = id
      }
    }
    return best
  }

  const dependents = new Map<string, Task[]>()
  const roots: Task[] = []
  let anyAnchor = false
  for (const t of lane) {
    const a = anchorOf(t)
    if (!a) {
      roots.push(t)
      continue
    }
    anyAnchor = true
    const arr = dependents.get(a)
    if (arr) arr.push(t)
    else dependents.set(a, [t])
  }
  if (!anyAnchor) return lane

  const out: Task[] = []
  const seen = new Set<string>()
  const emit = (t: Task) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    out.push(t)
    for (const d of dependents.get(t.id) ?? []) emit(d)
  }
  for (const t of roots) emit(t)
  // `dependsOn` is kept acyclic on write, but a hand-edited import could still
  // hand us a loop — those rows would never be emitted above. Append them in
  // their sorted position rather than dropping rows off the screen.
  for (const t of lane) if (!seen.has(t.id)) out.push(t)
  return out
}

/**
 * The ONE lane-ordering entry point: sort by the active column, then pull
 * dependents under their prerequisites. The List renders this and the PNG
 * export reuses it, so the image matches the screen row for row.
 */
export function orderLane(
  lane: Task[],
  sort: Sort,
  planById: Map<string, WorkingPlan>
): Task[] {
  const dateKeys =
    sort.field === 'startDate' || sort.field === 'dueDate'
      ? buildDateSortKeys(lane, planById)
      : undefined
  const sorted = [...lane].sort((a, b) =>
    compareTasks(a, b, sort.field ?? 'seq', sort.field ? sort.dir : 'asc', dateKeys)
  )
  return pullDependentsUnderPrereqs(sorted)
}
