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
