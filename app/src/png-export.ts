import type { Member, Task } from './types'
import type { WorkingPlan } from './scheduling'
import { flattenDisplayOrder } from './lib'
import { compareTasks, buildDateSortKeys, DEFAULT_SORT, type Sort } from './task-sort'

/**
 * Export the current view's tasks as one shareable PNG, grouped by assignee.
 * See design-docs/export-png.md. This module is the pure/glue layer:
 *  - `groupTasksByMember` — pure grouping (unit-tested)
 *  - `pngFilename` — safe filename
 *  - `renderNodeToPng` / `copyPngToClipboard` / `downloadPng` — DOM→image glue
 *    (dynamic-import `modern-screenshot` so it stays out of the initial bundle)
 */

export interface MemberGroup {
  /** null = the "Unassigned" bucket. */
  member: Member | null
  tasks: Task[]
}

/** Member lane order — mirrors `compareMembersByOrder` (order → name → id). */
function compareMembers(a: Member, b: Member): number {
  const d = (a.order ?? 0) - (b.order ?? 0)
  if (d !== 0) return d
  const n = a.name.localeCompare(b.name)
  if (n !== 0) return n
  return a.id.localeCompare(b.id)
}

export interface GroupOptions {
  /** The List's active sort (field/dir). Defaults to neutral = manual order. */
  sort?: Sort
  /** Computed schedule, needed only when sorting by Start/End. */
  planById?: Map<string, WorkingPlan>
  /** Nest group children right under their parent (List display order). */
  nestChildren?: boolean
}

/**
 * Group tasks by assignee EXACTLY as the List view lays them out — so the
 * exported image matches the screen (design-docs/export-png.md, list-view.md):
 *  - lanes ordered by `compareMembersByOrder` (order → name → id),
 *  - a task whose assignee is missing/deleted falls into the Unassigned bucket
 *    (same as the List's orphan lane), which sorts last (only when non-empty),
 *  - empty member lanes dropped (no point printing idle members),
 *  - tasks in a lane sorted with the shared `compareTasks` under the active
 *    sort (default neutral → `listOrder ?? sequence`), then children nested
 *    under their parent via `flattenDisplayOrder` when `nestChildren`.
 * Pure — no DB, no DOM.
 */
export function groupTasksByMember(
  tasks: Task[],
  members: Member[],
  opts: GroupOptions = {}
): MemberGroup[] {
  const sort = opts.sort ?? DEFAULT_SORT
  const planById = opts.planById ?? new Map<string, WorkingPlan>()

  const memberIds = new Set(members.map((m) => m.id))
  const byId = new Map<string, Task[]>()
  const unassigned: Task[] = []
  for (const t of tasks) {
    // Orphan (null OR unknown assignee) → Unassigned, matching the List.
    const owner = t.assigneeId && memberIds.has(t.assigneeId) ? t.assigneeId : null
    if (owner) {
      const arr = byId.get(owner)
      if (arr) arr.push(t)
      else byId.set(owner, [t])
    } else {
      unassigned.push(t)
    }
  }

  const orderLane = (lane: Task[]): Task[] => {
    const dateKeys =
      sort.field === 'startDate' || sort.field === 'dueDate'
        ? buildDateSortKeys(lane, planById)
        : undefined
    const sorted = [...lane].sort((a, b) =>
      compareTasks(a, b, sort.field ?? 'seq', sort.field ? sort.dir : 'asc', dateKeys)
    )
    return opts.nestChildren ? flattenDisplayOrder([sorted]) : sorted
  }

  const groups: MemberGroup[] = []
  for (const m of [...members].sort(compareMembers)) {
    const ts = byId.get(m.id)
    if (ts && ts.length) groups.push({ member: m, tasks: orderLane(ts) })
  }
  if (unassigned.length) {
    groups.push({ member: null, tasks: orderLane(unassigned) })
  }
  return groups
}

/** A filename-safe slug: lowercase, alnum + dashes, collapsed, trimmed. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (Vietnamese → ascii)
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** `plan-up-<view-slug>-<yyyy-mm-dd>.png` — falls back to "tasks" if slug empty. */
export function pngFilename(viewName: string, dateISO: string): string {
  const slug = slugify(viewName) || 'tasks'
  return `plan-up-${slug}-${dateISO}.png`
}

/** True iff the clipboard image API is usable (secure context + ClipboardItem). */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof window !== 'undefined' &&
    typeof window.ClipboardItem !== 'undefined' &&
    !!window.isSecureContext
  )
}

const RENDER_SCALE = 2

/** DOM node → PNG data-URL (white background, 2× for crisp text in chat). */
export async function renderNodeToPng(node: HTMLElement): Promise<string> {
  const { domToPng } = await import('modern-screenshot')
  return domToPng(node, { scale: RENDER_SCALE, backgroundColor: '#ffffff' })
}

/**
 * Copy the node as a PNG onto the clipboard. Returns false (never throws) when
 * the browser blocks it — callers fall back to Download.
 */
export async function copyPngToClipboard(node: HTMLElement): Promise<boolean> {
  if (!canCopyImage()) return false
  try {
    const { domToBlob } = await import('modern-screenshot')
    const blob = await domToBlob(node, {
      scale: RENDER_SCALE,
      backgroundColor: '#ffffff',
      type: 'image/png',
    })
    if (!blob) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

/** Trigger a download of a data-URL under `filename`. */
export function downloadPng(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
