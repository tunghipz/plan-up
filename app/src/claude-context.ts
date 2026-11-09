// Project snapshot for the Claude assistant (design-docs/claude-assistant.md): the whole
// project as compact text, plus short handles (m1 member, s1 sprint, t1 task) that Claude
// cites in its proposed changes and the app maps back to real ids.

import {
  db,
  compareMembersByOrder,
  computeBlockedIds,
  type ActivityEvent,
  type Collection,
  type Member,
  type Project,
  type Sprint,
  type Task,
} from './db'
import { stripRich } from './rich-text'

/** Above this many sprint tasks, archived sprints keep only their counts. */
export const ARCHIVED_TASK_CAP = 1500
/** Recent activity rows of the sprint on screen. */
const RECENT_EVENTS = 40

export interface ClaudeContextData {
  project: Project
  members: Member[]
  sprints: Sprint[]
  /** Every task of the project: sprint tasks and collection items. */
  tasks: Task[]
  collections: Collection[]
  /** Activity of the sprint on screen, newest first. */
  events: ActivityEvent[]
  currentSprintId: string | null
  /** Local `yyyy-mm-dd`. */
  today: string
}

export interface Handles {
  /** handle → id */
  member: Map<string, string>
  sprint: Map<string, string>
  task: Map<string, string>
  /** id → handle */
  memberOf: Map<string, string>
  sprintOf: Map<string, string>
  taskOf: Map<string, string>
}

export interface ClaudeContext {
  text: string
  handles: Handles
  /** For the panel header: "Reads … · N sprints · M tasks". */
  sprintCount: number
  taskCount: number
}

export async function loadContextData(
  projectId: string,
  currentSprintId: string | null,
  today: string
): Promise<ClaudeContextData | null> {
  const project = await db.projects.get(projectId)
  if (!project) return null
  const [members, sprints, tasks, collections, events] = await Promise.all([
    db.members.where('projectId').equals(projectId).toArray(),
    db.sprints.where('projectId').equals(projectId).toArray(),
    db.tasks.where('projectId').equals(projectId).toArray(),
    db.collections.where('projectId').equals(projectId).toArray(),
    currentSprintId ? db.events.where('sprintId').equals(currentSprintId).toArray() : Promise.resolve([]),
  ])
  return {
    project,
    members,
    sprints,
    tasks,
    collections,
    events: events.sort((a, b) => b.ts - a.ts).slice(0, RECENT_EVENTS),
    currentSprintId,
    today,
  }
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return WEEKDAY[new Date(y, m - 1, d).getDay()]
}

/** Quote a free-text value on one line. */
function q(s: string): string {
  return JSON.stringify(stripRich(s).replace(/\s+/g, ' ').trim())
}

function range(start: string | null, end: string | null): string {
  if (!start && !end) return 'no dates'
  return `${start ?? '?'} → ${end ?? '?'}`
}

function bySprintOrder(a: Sprint, b: Sprint): number {
  return a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name)
}

function counts(tasks: Task[]): string {
  const done = tasks.filter((t) => t.status === 'done').length
  const prog = tasks.filter((t) => t.status === 'in_progress').length
  const todo = tasks.length - done - prog
  return `${tasks.length} tasks (${done} done, ${prog} in progress, ${todo} to do)`
}

export function buildContext(data: ClaudeContextData): ClaudeContext {
  const { project, today } = data
  const handles: Handles = {
    member: new Map(),
    sprint: new Map(),
    task: new Map(),
    memberOf: new Map(),
    sprintOf: new Map(),
    taskOf: new Map(),
  }
  const members = [...data.members].sort(compareMembersByOrder)
  members.forEach((m, i) => {
    handles.member.set(`m${i + 1}`, m.id)
    handles.memberOf.set(m.id, `m${i + 1}`)
  })
  const sprints = [...data.sprints].sort(bySprintOrder)
  sprints.forEach((s, i) => {
    handles.sprint.set(`s${i + 1}`, s.id)
    handles.sprintOf.set(s.id, `s${i + 1}`)
  })

  const sprintTasks = data.tasks.filter((t) => t.sprintId)
  const tasksBySprint = new Map<string, Task[]>()
  for (const t of sprintTasks) {
    const list = tasksBySprint.get(t.sprintId!) ?? []
    list.push(t)
    tasksBySprint.set(t.sprintId!, list)
  }
  for (const list of tasksBySprint.values()) list.sort((a, b) => a.sequence - b.sequence)
  const dropArchived = sprintTasks.length > ARCHIVED_TASK_CAP
  const listed = (s: Sprint) => !(dropArchived && s.archivedAt != null)

  let n = 0
  for (const s of sprints) {
    if (!listed(s)) continue
    for (const t of tasksBySprint.get(s.id) ?? []) {
      n++
      handles.task.set(`t${n}`, t.id)
      handles.taskOf.set(t.id, `t${n}`)
    }
  }

  const byId = new Map(data.tasks.map((t) => [t.id, t]))
  const blocked = computeBlockedIds(byId)
  const parentIds = new Set(data.tasks.filter((t) => t.parentId).map((t) => t.parentId!))
  const memberHandle = (id: string | null | undefined) =>
    id ? handles.memberOf.get(id) ?? 'unknown member' : 'unassigned'
  const memberName = new Map(members.map((m) => [m.id, m.name]))

  const out: string[] = []
  out.push(`Today: ${today} (${weekday(today)})`)
  out.push(`Project: ${q(project.name)}`)
  if (project.description?.trim()) out.push(`Description: ${q(project.description)}`)
  const holidays = project.holidays ?? []
  if (holidays.length) {
    out.push('Project holidays (nobody works, except the listed members):')
    for (const h of holidays) {
      const except = h.exceptMemberIds?.length
        ? ` (still working: ${h.exceptMemberIds.map(memberHandle).join(', ')})`
        : ''
      out.push(`- ${q(h.name)} ${h.from === h.to ? h.from : `${h.from} → ${h.to}`}${h.half ? ` ${h.half} only` : ''}${except}`)
    }
  }

  out.push('')
  out.push('## Members')
  if (!members.length) out.push('(none)')
  for (const m of members) {
    const parts = [`${handles.memberOf.get(m.id)} ${q(m.name)}`]
    if (m.title?.trim()) parts.push(`role ${q(m.title)}`)
    const off = [...(m.daysOff ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    if (off.length) parts.push(`days off: ${off.map((d) => (d.half ? `${d.date} ${d.half}` : d.date)).join(', ')}`)
    out.push(`- ${parts.join(' · ')}`)
  }

  out.push('')
  out.push('## Sprints (oldest first; each lasts 2 weeks, weekends are off)')
  if (!sprints.length) out.push('(none)')
  for (const s of sprints) {
    const parts = [`${handles.sprintOf.get(s.id)} ${q(s.name)}`, `${s.startDate} → ${s.endDate}`]
    if (s.id === data.currentSprintId) parts.push('ON SCREEN NOW')
    if (s.archivedAt != null) parts.push('archived')
    else if (s.endDate < today) parts.push('ended')
    else if (s.startDate > today) parts.push('upcoming')
    else parts.push('running')
    if (s.note?.trim()) parts.push(`goal: ${q(s.note)}`)
    parts.push(counts(tasksBySprint.get(s.id) ?? []))
    out.push(`- ${parts.join(' · ')}`)
  }

  out.push('')
  out.push('## Sprint tasks')
  out.push(
    'Format: handle #number "title" · status · priority · assignee · start → due · effort · flags. ' +
      '"#number" is what the user sees in the app (numbers restart in every sprint).'
  )
  for (const s of sprints) {
    const list = tasksBySprint.get(s.id) ?? []
    if (!list.length) continue
    out.push('')
    out.push(`### ${handles.sprintOf.get(s.id)} ${q(s.name)}`)
    if (!listed(s)) {
      out.push(`(archived, tasks left out to save space: ${counts(list)})`)
      continue
    }
    for (const t of list) {
      const parts = [`${handles.taskOf.get(t.id)} #${t.sequence} ${q(t.title)}`, t.status]
      if (t.priority === 'urgent' || t.priority === 'high' || t.priority === 'low') parts.push(t.priority)
      parts.push(t.assigneeId ? `${memberHandle(t.assigneeId)} ${memberName.get(t.assigneeId) ?? ''}`.trim() : 'unassigned')
      parts.push(range(t.startDate, t.dueDate))
      if (t.estimate === 0) parts.push('milestone')
      else if (t.estimate != null) parts.push(`effort ${t.estimate}d`)
      const flags: string[] = []
      if (t.dueDate && t.dueDate < today && t.status !== 'done') flags.push('OVERDUE')
      if (blocked.has(t.id)) flags.push('blocked')
      if (parentIds.has(t.id)) flags.push('group')
      if (t.parentId) flags.push(`in group ${handles.taskOf.get(t.parentId) ?? '?'}`)
      const deps = (t.dependsOn ?? []).map((id) => handles.taskOf.get(id)).filter(Boolean)
      if (deps.length) flags.push(`after ${deps.join(', ')}`)
      if (flags.length) parts.push(flags.join(', '))
      out.push(parts.join(' · '))
    }
  }

  const collections = [...data.collections].sort((a, b) => a.order - b.order)
  if (collections.length) {
    out.push('')
    out.push('## Collections (task lists outside sprints; read-only for you)')
    for (const c of collections) {
      const items = data.tasks.filter((t) => t.collectionId === c.id)
      const statusName = new Map(c.statuses.map((st) => [st.id, st.name]))
      const sectionName = new Map(c.sections.map((sec) => [sec.id, sec.name]))
      out.push('')
      out.push(
        `### ${q(c.name)} · ${items.length} items` +
          (c.statuses.length ? ` · statuses: ${c.statuses.map((st) => st.name).join(', ')}` : '')
      )
      for (const t of items) {
        const parts = [q(t.title)]
        const st = t.collectionStatusId ? statusName.get(t.collectionStatusId) : undefined
        if (st) parts.push(st)
        if (c.sections.length > 1 && t.sectionId) parts.push(`table ${q(sectionName.get(t.sectionId) ?? '?')}`)
        if (t.assigneeId) parts.push(memberName.get(t.assigneeId) ?? 'unknown member')
        parts.push(range(t.startDate, t.dueDate))
        out.push(`- ${parts.join(' · ')}`)
      }
    }
  }

  const current = sprints.find((s) => s.id === data.currentSprintId)
  if (current && data.events.length) {
    out.push('')
    out.push(`## Recent activity in ${q(current.name)} (newest first)`)
    for (const e of data.events) {
      const when = new Date(e.ts)
      const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
      const task = e.taskSeq != null ? `#${e.taskSeq} ${q(e.taskTitle ?? '')}` : ''
      let what: string = e.kind
      if (e.kind === 'edit') what = `${e.field}: ${e.from ?? '—'} → ${e.to ?? '—'}`
      else if (e.kind === 'rolled_over') what = `moved in from ${e.from ?? '?'}`
      out.push(`- ${stamp} ${task} ${what}`.replace(/\s+/g, ' '))
    }
  }

  return {
    text: out.join('\n'),
    handles,
    sprintCount: sprints.length,
    taskCount: sprintTasks.length,
  }
}
