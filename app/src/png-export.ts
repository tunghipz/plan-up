import type { Member, Task } from './types'

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

/** Sort key for a task within a member group: manual list order, else sequence. */
function taskOrder(t: Task): number {
  return t.listOrder ?? t.sequence
}

/**
 * Group tasks by assignee, ordered for display:
 *  - member groups first, sorted by `Member.order` (lane order) then name,
 *  - the Unassigned bucket last (only when it has tasks),
 *  - empty member groups dropped (no point printing idle members),
 *  - tasks inside a group sorted by `listOrder ?? sequence`.
 * Pure — no DB, no DOM. This mirrors what the user sees in the List view.
 */
export function groupTasksByMember(
  tasks: Task[],
  members: Member[]
): MemberGroup[] {
  const byId = new Map<string, Task[]>()
  const unassigned: Task[] = []
  for (const t of tasks) {
    if (t.assigneeId) {
      const arr = byId.get(t.assigneeId)
      if (arr) arr.push(t)
      else byId.set(t.assigneeId, [t])
    } else {
      unassigned.push(t)
    }
  }

  const ordered = [...members].sort((a, b) => {
    const ao = a.order ?? 0
    const bo = b.order ?? 0
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })

  const groups: MemberGroup[] = []
  for (const m of ordered) {
    const ts = byId.get(m.id)
    if (ts && ts.length) {
      groups.push({ member: m, tasks: [...ts].sort((a, b) => taskOrder(a) - taskOrder(b)) })
    }
  }
  if (unassigned.length) {
    groups.push({
      member: null,
      tasks: [...unassigned].sort((a, b) => taskOrder(a) - taskOrder(b)),
    })
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
