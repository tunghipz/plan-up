import type { Collection, Member, Section, Sprint, Status, Task } from './types'
import { groupTasksByMember } from './png-export'
import { formatShortDate, formatSprintRange } from './lib'

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

/** Status shown as WORDS, not glyphs — the whole point of this export. Vietnamese
 * to match the team; swap to STATUS_LABEL (lib.ts) for English. */
export const STATUS_TEXT_VI: Record<Status, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  done: 'Xong',
}

const BRANCH_MID = '├─'
const BRANCH_LAST = '└─'
const PIPE_MID = '│  '
const PIPE_LAST = '   '

/** Task line meta: ` — Status[ · Due]` (due dropped when absent). */
function taskMeta(t: Task): string {
  const parts = [STATUS_TEXT_VI[t.status]]
  if (t.dueDate) parts.push(formatShortDate(t.dueDate))
  return ' — ' + parts.join(' · ')
}

/** Subtask line meta: ` — Status` (children never show #seq or due). */
function subMeta(t: Task): string {
  return ' — ' + STATUS_TEXT_VI[t.status]
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
    L.push(`${lastG ? BRANCH_LAST : BRANCH_MID} 👤 ${g.member ? g.member.name : 'Chưa gán'}`)

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
    const top = g.tasks.filter((t) => !isChild(t))

    top.forEach((t, ti) => {
      const lastT = ti === top.length - 1
      const tPipe = lastT ? PIPE_LAST : PIPE_MID
      L.push(`${gPipe}${lastT ? BRANCH_LAST : BRANCH_MID} #${t.sequence} ${t.title}${taskMeta(t)}`)
      const kids = childrenByParent.get(t.id) ?? []
      kids.forEach((k, ki) => {
        const lastK = ki === kids.length - 1
        L.push(`${gPipe}${tPipe}${lastK ? BRANCH_LAST : BRANCH_MID} ${k.title}${subMeta(k)}`)
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

/** `startDate → dueDate` range (either side may be absent; '' when neither). */
function dateRange(t: Task): string {
  const a = t.startDate ? formatShortDate(t.startDate) : ''
  const b = t.dueDate ? formatShortDate(t.dueDate) : ''
  if (a && b) return `${a} → ${b}`
  return a || b || ''
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
  const meta = (t: Task) => {
    const parts: string[] = []
    const s = nameOf(t)
    if (s) parts.push(s)
    const d = dateRange(t)
    if (d) parts.push(d)
    return parts.length ? ' — ' + parts.join(' · ') : ''
  }
  const subMeta = (t: Task) => {
    const s = nameOf(t)
    return s ? ' — ' + s : ''
  }

  // Items per section, in the List's default order (listOrder ?? sequence).
  const bySection = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!t.sectionId) continue
    const arr = bySection.get(t.sectionId) ?? []
    arr.push(t)
    bySection.set(t.sectionId, arr)
  }
  const ordered = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.listOrder ?? a.sequence) - (b.listOrder ?? b.sequence))

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
        L.push(`${sPipe}${tPipe}${lastK ? BRANCH_LAST : BRANCH_MID} ${k.title}${subMeta(k)}`)
      })
    })
  })

  return L.join('\n')
}
