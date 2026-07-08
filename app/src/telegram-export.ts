import type { Member, Sprint, Status, Task } from './types'
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
