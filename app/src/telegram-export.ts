import type { Collection, Member, Section, Sprint, Task } from './types'
import { groupTasksByMember } from './png-export'
import { formatShortDate, formatSprintRange, STATUS_LABEL } from './lib'

/**
 * Copy a sprint as plain "Tree" text for pasting straight into Telegram (or any
 * chat). Pure — no React, no DOM, no clipboard — so the grammar is unit-tested
 * in isolation (telegram-export.test.ts). See design-docs/copy-to-telegram.md.
 *
 * Why text (not the PNG export): text is editable after pasting, light, and
 * searchable in chat. Telegram pastes as PLAIN text (no markdown) in a
 * proportional font, so formatting lives in leading tree characters + line
 * breaks — never space-padded columns.
 */

// Status shown as WORDS, not glyphs — the whole point of this export. Reuses the
// app's STATUS_LABEL ('To do' / 'In progress' / 'Done') so the export matches the UI.

const BRANCH_MID = '├─'
const BRANCH_LAST = '└─'
const PIPE_MID = '│  '
const PIPE_LAST = '   '

/** `startDate → dueDate` range (either side may be absent; '' when neither).
 * Shared by the sprint and collection trees so both read the same way. */
function dateRange(t: Task): string {
  const a = t.startDate ? formatShortDate(t.startDate) : ''
  const b = t.dueDate ? formatShortDate(t.dueDate) : ''
  if (a && b) return `${a} → ${b}`
  return a || b || ''
}

/**
 * Order a lane/section by END date: `dueDate` ascending (ISO `yyyy-mm-dd` strings
 * compare chronologically), tasks with no end date sink to the BOTTOM, and ties
 * fall back to the List's manual order (`listOrder ?? sequence`) so the result is
 * stable. This is the copy's own order — it intentionally diverges from the
 * List/PNG manual order (see design-docs/copy-to-telegram.md). Exported so the
 * share-link read-only viewer orders its board the same way.
 */
export function byEnd(a: Task, b: Task): number {
  const ea = a.dueDate ?? ''
  const eb = b.dueDate ?? ''
  if (ea !== eb) {
    if (!ea) return 1 // a undated → after b
    if (!eb) return -1 // b undated → after a
    return ea < eb ? -1 : 1
  }
  return (a.listOrder ?? a.sequence) - (b.listOrder ?? b.sequence)
}

/** Task/subtask line meta: ` — Status[ · start → end]` (range dropped when both
 * dates absent). Identical for top-level tasks and children — only the leading
 * `#seq`, added by the caller, differs. */
function taskMeta(t: Task): string {
  const parts = [STATUS_LABEL[t.status]]
  const d = dateRange(t)
  if (d) parts.push(d)
  return ' — ' + parts.join(' · ')
}

export interface TreeOptions {
  /** Restrict to one member's lane (by Member.id). Omit/null = whole sprint. */
  memberId?: string | null
}

/**
 * Real members (not the "Unassigned" bucket) that own at least one task in this
 * sprint — the scope picker's per-member options, in the same lane order as the
 * tree. Empty when nobody is assigned.
 */
export function membersWithTasks(members: Member[], tasks: Task[]): Member[] {
  return groupTasksByMember(tasks, members)
    .map((g) => g.member)
    .filter((m): m is Member => m != null)
}

export function formatSprintTree(
  sprint: Sprint,
  members: Member[],
  tasks: Task[],
  opts: TreeOptions = {}
): string {
  let groups = groupTasksByMember(tasks, members)
  if (opts.memberId != null) {
    groups = groups.filter((g) => g.member?.id === opts.memberId)
  }

  const L: string[] = []
  L.push(`📋 ${sprint.name}  ·  ${formatSprintRange(sprint.startDate, sprint.endDate)}`)

  groups.forEach((g, gi) => {
    const lastG = gi === groups.length - 1
    const gPipe = lastG ? PIPE_LAST : PIPE_MID
    L.push('│')
    L.push(`${lastG ? BRANCH_LAST : BRANCH_MID} 👤 ${g.member ? g.member.name : 'Unassigned'}`)

    // Nest children under their parent within THIS lane — mirrors
    // flattenDisplayOrder (a child whose parent isn't in the lane renders as a
    // top-level task, same as the List).
    const idSet = new Set(g.tasks.map((t) => t.id))
    const childrenByParent = new Map<string, Task[]>()
    for (const t of g.tasks) {
      if (t.parentId && idSet.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? []
        arr.push(t)
        childrenByParent.set(t.parentId, arr)
      }
    }
    const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
    // Copy orders each lane by end date (undated last), not the List's manual
    // order. `filter` already returns a fresh array, so sorting it is safe.
    const top = g.tasks.filter((t) => !isChild(t)).sort(byEnd)

    top.forEach((t, ti) => {
      const lastT = ti === top.length - 1
      const tPipe = lastT ? PIPE_LAST : PIPE_MID
      L.push(`${gPipe}${lastT ? BRANCH_LAST : BRANCH_MID} #${t.sequence} ${t.title}${taskMeta(t)}`)
      const kids = (childrenByParent.get(t.id) ?? []).slice().sort(byEnd)
      kids.forEach((k, ki) => {
        const lastK = ki === kids.length - 1
        L.push(`${gPipe}${tPipe}${lastK ? BRANCH_LAST : BRANCH_MID} ${k.title}${taskMeta(k)}`)
      })
    })
  })

  return L.join('\n')
}

// ──────────────────────────────────────────────────────────────────────────
// Collections — same Tree, but grouped by SECTION (📁), no #seq (the collection
// List has no ID column), status = the item's custom CollectionStatus NAME, and
// dates render as a start→end range. See design-docs/copy-to-telegram.md.
// ──────────────────────────────────────────────────────────────────────────

export interface CollectionTreeOptions {
  /** Restrict to one section (by Section.id). Omit/null = whole collection. */
  sectionId?: string | null
}

/** Sections (in the collection's order) that own at least one item — the scope
 * picker's per-section options. */
export function sectionsWithItems(collection: Collection, tasks: Task[]): Section[] {
  const used = new Set(tasks.map((t) => t.sectionId).filter(Boolean) as string[])
  return collection.sections.filter((s) => used.has(s.id))
}

export function formatCollectionTree(
  collection: Collection,
  tasks: Task[],
  opts: CollectionTreeOptions = {}
): string {
  const statusName = new Map(collection.statuses.map((s) => [s.id, s.name]))
  const nameOf = (t: Task) =>
    t.collectionStatusId ? statusName.get(t.collectionStatusId) : undefined
  // Item AND subtask meta: custom status name + `start → end` range (either
  // dropped when absent). Same for both — subtasks now carry the range too.
  const meta = (t: Task) => {
    const parts: string[] = []
    const s = nameOf(t)
    if (s) parts.push(s)
    const d = dateRange(t)
    if (d) parts.push(d)
    return parts.length ? ' — ' + parts.join(' · ') : ''
  }

  // Items per section, in the List's default order (listOrder ?? sequence).
  const bySection = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.sectionId) continue
    const arr = bySection.get(t.sectionId) ?? []
    arr.push(t)
    bySection.set(t.sectionId, arr)
  }
  // End-date order (undated last), matching the sprint tree — was listOrder.
  const ordered = (arr: Task[]) => [...arr].sort(byEnd)

  let sections = collection.sections
  if (opts.sectionId != null) sections = sections.filter((s) => s.id === opts.sectionId)
  const shown = sections.filter((s) => (bySection.get(s.id)?.length ?? 0) > 0)

  const L: string[] = [`📋 ${collection.name}`]
  shown.forEach((sec, si) => {
    const lastS = si === shown.length - 1
    const sPipe = lastS ? PIPE_LAST : PIPE_MID
    L.push('│')
    L.push(`${lastS ? BRANCH_LAST : BRANCH_MID} 📁 ${sec.name}`)

    const items = ordered(bySection.get(sec.id) ?? [])
    const idSet = new Set(items.map((t) => t.id))
    const childrenByParent = new Map<string, Task[]>()
    for (const t of items) {
      if (t.parentId && idSet.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? []
        arr.push(t)
        childrenByParent.set(t.parentId, arr)
      }
    }
    const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
    const top = items.filter((t) => !isChild(t))

    top.forEach((t, ti) => {
      const lastT = ti === top.length - 1
      const tPipe = lastT ? PIPE_LAST : PIPE_MID
      L.push(`${sPipe}${lastT ? BRANCH_LAST : BRANCH_MID} ${t.title}${meta(t)}`)
      const kids = childrenByParent.get(t.id) ?? []
      kids.forEach((k, ki) => {
        const lastK = ki === kids.length - 1
        L.push(`${sPipe}${tPipe}${lastK ? BRANCH_LAST : BRANCH_MID} ${k.title}${meta(k)}`)
      })
    })
  })

  return L.join('\n')
}
