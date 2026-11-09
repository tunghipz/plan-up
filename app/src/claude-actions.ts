// Proposed data changes from the Claude assistant (design-docs/claude-assistant.md): check
// each one against the snapshot Claude saw, describe it for the checklist, and apply the ones
// the user keeps through the same DB functions the UI uses.

import {
  db,
  addSprintTask,
  deleteTask,
  moveTasksToSprint,
  reassignTasks,
  recomputeDates,
  setDependencies,
  setSprintNote,
  updateTask,
  type Priority,
  type Status,
  type Task,
} from './db'
import type { ClaudeContextData, Handles } from './claude-context'
import { ACTION_OPS } from './claude-prompt'
import { PRIORITY_LABEL, STATUS_LABEL, formatShortDate } from './lib'
import { stripRich } from './rich-text'

export type ActionOp = (typeof ACTION_OPS)[number]

const STATUSES: Status[] = ['todo', 'in_progress', 'done']
const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low', 'none']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ACTIONS = 60

export type ActionVerb = 'Create' | 'Edit' | 'Move' | 'Delete' | 'Prereqs' | 'Note'

/** A task an action points at: an existing task, or one created earlier in the same list. */
export type TaskRef = { id: string } | { ref: string }

export interface ResolvedAction {
  key: string
  op: ActionOp
  verb: ActionVerb
  /** `#12 "Login API"` / `"New title"` / `Sprint 13`. */
  subject: string
  /** One line per change: `status To Do → Done`. */
  details: string[]
  reason?: string
  /** Why it can't run; such a row is shown disabled. */
  error?: string
  // ── payload ──
  task?: TaskRef
  sprintId?: string
  ref?: string
  create?: {
    title: string
    assigneeId: string | null
    status: Status
    priority: Priority
    startDate: string | null
    dueDate: string | null
    estimate: number | null
  }
  patch?: Partial<Pick<Task, 'title' | 'status' | 'priority' | 'assigneeId' | 'startDate' | 'dueDate' | 'estimate'>>
  dependsOn?: TaskRef[]
  note?: string
}

type Raw = Record<string, unknown>

function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function dateLabel(v: string | null | undefined): string {
  return v ? formatShortDate(v) : '—'
}

function titleOf(t: Task): string {
  return `#${t.sequence} "${stripRich(t.title)}"`
}

/**
 * Check every raw action against the snapshot Claude was given. Never throws: anything that
 * can't run gets an `error` and is shown disabled.
 */
export function resolveActions(raw: unknown, data: ClaudeContextData, handles: Handles): ResolvedAction[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_ACTIONS) : []
  const tasks = new Map(data.tasks.map((t) => [t.id, t]))
  const sprints = new Map(data.sprints.map((s) => [s.id, s]))
  const members = new Map(data.members.map((m) => [m.id, m]))
  // ref → sprint the new task goes into, for refs created earlier in the list.
  const created = new Map<string, { sprintId: string; title: string }>()

  const out: ResolvedAction[] = []
  list.forEach((item, i) => {
    const a = (item && typeof item === 'object' ? item : {}) as Raw
    const op = ACTION_OPS.includes(a.op as ActionOp) ? (a.op as ActionOp) : null
    const reason = typeof a.reason === 'string' && a.reason.trim() ? a.reason.trim() : undefined
    const base = { key: `a${i}`, reason }
    if (!op) {
      out.push({ ...base, op: 'update_task', verb: 'Edit', subject: '?', details: [], error: `Unknown action "${String(a.op)}"` })
      return
    }

    const fail = (verb: ActionVerb, subject: string, error: string) =>
      out.push({ ...base, op, verb, subject, details: [], error })

    const taskHandle = typeof a.task === 'string' ? a.task.trim() : ''
    const existing = handles.task.has(taskHandle) ? tasks.get(handles.task.get(taskHandle)!) : undefined
    const createdRef = created.get(taskHandle)
    const sprintHandle = typeof a.sprint === 'string' ? a.sprint.trim() : ''
    const sprintId = handles.sprint.get(sprintHandle)
    const sprint = sprintId ? sprints.get(sprintId) : undefined

    const memberField = (): { ok: true; id: string | null } | { ok: false; error: string } | null => {
      if (!('assignee' in a)) return null
      if (a.assignee === null || a.assignee === '') return { ok: true, id: null }
      const id = typeof a.assignee === 'string' ? handles.member.get(a.assignee.trim()) : undefined
      return id && members.has(id) ? { ok: true, id } : { ok: false, error: `Unknown member "${String(a.assignee)}"` }
    }
    const dateField = (k: 'start' | 'due'): { ok: true; v: string | null } | { ok: false; error: string } | null => {
      if (!(k in a)) return null
      if (a[k] === null || a[k] === '') return { ok: true, v: null }
      return isDate(a[k]) ? { ok: true, v: a[k] as string } : { ok: false, error: `Bad ${k} date "${String(a[k])}"` }
    }
    const estimateField = (): { ok: true; v: number | null } | { ok: false; error: string } | null => {
      if (!('estimate' in a)) return null
      if (a.estimate === null) return { ok: true, v: null }
      const n = Number(a.estimate)
      return Number.isFinite(n) && n >= 0 && n <= 365
        ? { ok: true, v: Math.round(n * 2) / 2 }
        : { ok: false, error: `Bad effort "${String(a.estimate)}"` }
    }
    const memberName = (id: string | null) => (id ? members.get(id)?.name ?? '?' : 'Unassigned')

    switch (op) {
      case 'create_task': {
        const title = typeof a.title === 'string' ? a.title.trim() : ''
        const targetId = sprintId ?? (sprintHandle ? undefined : data.currentSprintId ?? undefined)
        const target = targetId ? sprints.get(targetId) : undefined
        const subject = `"${stripRich(title) || '?'}"`
        if (!title) return fail('Create', subject, 'Missing title')
        if (!target) return fail('Create', subject, sprintHandle ? `Unknown sprint "${sprintHandle}"` : 'No sprint to put it in')
        if (target.archivedAt != null) return fail('Create', subject, `${target.name} is archived`)
        const assignee = memberField()
        const start = dateField('start')
        const due = dateField('due')
        const estimate = estimateField()
        for (const f of [assignee, start, due, estimate]) if (f && !f.ok) return fail('Create', subject, f.error)
        const create = {
          title,
          assigneeId: assignee?.ok ? assignee.id : null,
          status: STATUSES.includes(a.status as Status) ? (a.status as Status) : 'todo',
          priority: PRIORITIES.includes(a.priority as Priority) ? (a.priority as Priority) : 'normal',
          startDate: start?.ok ? start.v : null,
          dueDate: due?.ok ? due.v : null,
          estimate: estimate?.ok ? estimate.v : null,
        }
        const details = [`in ${target.name}`, memberName(create.assigneeId)]
        if (create.status !== 'todo') details.push(STATUS_LABEL[create.status])
        if (create.priority === 'urgent' || create.priority === 'high') details.push(PRIORITY_LABEL[create.priority])
        if (create.startDate) details.push(`start ${dateLabel(create.startDate)}`)
        if (create.dueDate) details.push(`due ${dateLabel(create.dueDate)}`)
        if (create.estimate != null) details.push(create.estimate === 0 ? 'milestone' : `${create.estimate}d effort`)
        const ref = typeof a.ref === 'string' && a.ref.trim() ? a.ref.trim() : undefined
        if (ref) created.set(ref, { sprintId: target.id, title })
        out.push({ ...base, op, verb: 'Create', subject, details: [details.join(' · ')], sprintId: target.id, ref, create })
        return
      }

      case 'update_task': {
        if (!existing && !createdRef) return fail('Edit', taskHandle || '?', `Unknown task "${taskHandle}"`)
        const subject = existing ? titleOf(existing) : `"${createdRef!.title}" (new)`
        const patch: NonNullable<ResolvedAction['patch']> = {}
        const details: string[] = []
        const before = existing
        if (typeof a.title === 'string' && a.title.trim() && a.title.trim() !== before?.title) {
          patch.title = a.title.trim()
          details.push(`title → "${stripRich(patch.title)}"`)
        }
        if (STATUSES.includes(a.status as Status) && a.status !== before?.status) {
          patch.status = a.status as Status
          details.push(`status ${before ? STATUS_LABEL[before.status] : ''} → ${STATUS_LABEL[patch.status]}`.replace('  ', ' '))
        }
        if (PRIORITIES.includes(a.priority as Priority) && a.priority !== before?.priority) {
          patch.priority = a.priority as Priority
          details.push(`priority ${before ? PRIORITY_LABEL[before.priority] : ''} → ${PRIORITY_LABEL[patch.priority]}`.replace('  ', ' '))
        }
        const assignee = memberField()
        if (assignee && !assignee.ok) return fail('Edit', subject, assignee.error)
        if (assignee?.ok && (!before || assignee.id !== before.assigneeId)) {
          patch.assigneeId = assignee.id
          details.push(`assignee ${before ? memberName(before.assigneeId) : ''} → ${memberName(assignee.id)}`.replace('  ', ' '))
        }
        const start = dateField('start')
        if (start && !start.ok) return fail('Edit', subject, start.error)
        if (start?.ok && start.v !== before?.startDate) {
          patch.startDate = start.v
          details.push(`start ${dateLabel(before?.startDate)} → ${dateLabel(start.v)}`)
        }
        const due = dateField('due')
        if (due && !due.ok) return fail('Edit', subject, due.error)
        if (due?.ok && due.v !== before?.dueDate) {
          patch.dueDate = due.v
          details.push(`due ${dateLabel(before?.dueDate)} → ${dateLabel(due.v)}`)
        }
        const estimate = estimateField()
        if (estimate && !estimate.ok) return fail('Edit', subject, estimate.error)
        if (estimate?.ok && estimate.v !== before?.estimate) {
          patch.estimate = estimate.v
          const fmt = (v: number | null | undefined) => (v == null ? '—' : v === 0 ? 'milestone' : `${v}d`)
          details.push(`effort ${fmt(before?.estimate)} → ${fmt(estimate.v)}`)
        }
        if (!Object.keys(patch).length) return fail('Edit', subject, 'Nothing to change')
        out.push({
          ...base,
          op,
          verb: 'Edit',
          subject,
          details,
          task: existing ? { id: existing.id } : { ref: taskHandle },
          patch,
        })
        return
      }

      case 'move_task': {
        if (!existing) return fail('Move', taskHandle || '?', `Unknown task "${taskHandle}"`)
        const subject = titleOf(existing)
        if (!sprint) return fail('Move', subject, sprintHandle ? `Unknown sprint "${sprintHandle}"` : 'Missing target sprint')
        if (sprint.archivedAt != null) return fail('Move', subject, `${sprint.name} is archived`)
        if (sprint.id === existing.sprintId) return fail('Move', subject, `Already in ${sprint.name}`)
        const from = existing.sprintId ? sprints.get(existing.sprintId)?.name ?? '?' : '?'
        const kids = data.tasks.filter((t) => t.parentId === existing.id).length
        const details = [`${from} → ${sprint.name}`]
        if (kids) details.push(`with its ${kids} subtask${kids === 1 ? '' : 's'}`)
        else if (existing.parentId) details.push('leaves its group')
        out.push({ ...base, op, verb: 'Move', subject, details, task: { id: existing.id }, sprintId: sprint.id })
        return
      }

      case 'delete_task': {
        if (!existing) return fail('Delete', taskHandle || '?', `Unknown task "${taskHandle}"`)
        const where = existing.sprintId ? sprints.get(existing.sprintId)?.name : undefined
        out.push({
          ...base,
          op,
          verb: 'Delete',
          subject: titleOf(existing),
          details: where ? [`from ${where}`] : [],
          task: { id: existing.id },
        })
        return
      }

      case 'set_dependencies': {
        if (!existing && !createdRef) return fail('Prereqs', taskHandle || '?', `Unknown task "${taskHandle}"`)
        const subject = existing ? titleOf(existing) : `"${createdRef!.title}" (new)`
        const homeSprint = existing?.sprintId ?? createdRef!.sprintId
        const raws = Array.isArray(a.dependsOn) ? a.dependsOn.map((x) => String(x).trim()) : []
        const refs: TaskRef[] = []
        const labels: string[] = []
        for (const h of raws) {
          if (h === taskHandle) return fail('Prereqs', subject, 'A task cannot depend on itself')
          const dep = handles.task.has(h) ? tasks.get(handles.task.get(h)!) : undefined
          const depNew = created.get(h)
          if (!dep && !depNew) return fail('Prereqs', subject, `Unknown task "${h}"`)
          if ((dep?.sprintId ?? depNew?.sprintId) !== homeSprint) {
            return fail('Prereqs', subject, 'Prerequisites must be in the same sprint')
          }
          refs.push(dep ? { id: dep.id } : { ref: h })
          labels.push(dep ? `#${dep.sequence}` : `"${depNew!.title}"`)
        }
        out.push({
          ...base,
          op,
          verb: 'Prereqs',
          subject,
          details: [labels.length ? `after ${labels.join(', ')}` : 'no prerequisites'],
          task: existing ? { id: existing.id } : { ref: taskHandle },
          dependsOn: refs,
        })
        return
      }

      case 'set_sprint_note': {
        if (!sprint) return fail('Note', sprintHandle || '?', `Unknown sprint "${sprintHandle}"`)
        const note = typeof a.note === 'string' ? a.note.trim() : ''
        if (note === (sprint.note ?? '').trim()) return fail('Note', sprint.name, 'Nothing to change')
        out.push({
          ...base,
          op,
          verb: 'Note',
          subject: sprint.name,
          details: [note ? `"${note}"` : 'clear the goal'],
          sprintId: sprint.id,
          note,
        })
        return
      }
    }
  })
  return out
}

/** Short summary for the next prompt and the applied card: "2 created, 3 edited". */
export function summarizeActions(actions: ResolvedAction[]): string {
  const n = new Map<ActionVerb, number>()
  for (const a of actions) n.set(a.verb, (n.get(a.verb) ?? 0) + 1)
  const word: Record<ActionVerb, string> = {
    Create: 'created',
    Edit: 'edited',
    Move: 'moved',
    Delete: 'deleted',
    Prereqs: 'prerequisites set',
    Note: 'sprint goal set',
  }
  return [...n].map(([verb, count]) => `${count} ${word[verb]}`).join(', ')
}

export interface ApplyResult {
  applied: number
  /** Set when an action failed; the ones before it stay applied. */
  error?: string
}

/**
 * Apply in order. Re-checks that every task still exists (the user may have edited the
 * board since Claude answered); stops at the first failure.
 */
export async function applyActions(actions: ResolvedAction[], projectId: string): Promise<ApplyResult> {
  const createdIds = new Map<string, string>()
  const idOf = (r: TaskRef | undefined) => (!r ? undefined : 'id' in r ? r.id : createdIds.get(r.ref))
  let applied = 0
  for (const a of actions) {
    if (a.error) continue
    try {
      switch (a.op) {
        case 'create_task': {
          const sprint = await db.sprints.get(a.sprintId!)
          if (!sprint) throw new Error('its sprint no longer exists')
          const c = a.create!
          const task = await addSprintTask({
            projectId,
            sprintId: sprint.id,
            title: c.title,
            startDate: c.startDate ?? sprint.startDate,
            assigneeId: c.assigneeId,
            status: c.status,
            priority: c.priority,
          })
          if (a.ref) createdIds.set(a.ref, task.id)
          if (c.dueDate !== null || c.estimate !== null) {
            await updateTask(task.id, {
              ...(c.dueDate !== null ? { dueDate: c.dueDate } : {}),
              ...(c.estimate !== null ? { estimate: c.estimate } : {}),
            })
          }
          await recomputeDates(task.id)
          break
        }
        case 'update_task': {
          const id = idOf(a.task)
          if (!id || !(await db.tasks.get(id))) throw new Error('the task no longer exists')
          const { assigneeId, ...rest } = a.patch!
          if (assigneeId !== undefined) await reassignTasks([id], assigneeId, { keepOrder: true })
          if (Object.keys(rest).length) await updateTask(id, rest)
          await recomputeDates(id)
          break
        }
        case 'move_task': {
          const id = idOf(a.task)
          if (!id || !(await db.tasks.get(id))) throw new Error('the task no longer exists')
          await moveTasksToSprint([id], a.sprintId!)
          break
        }
        case 'delete_task': {
          const id = idOf(a.task)
          if (!id || !(await db.tasks.get(id))) throw new Error('the task no longer exists')
          await deleteTask(id)
          break
        }
        case 'set_dependencies': {
          const id = idOf(a.task)
          if (!id || !(await db.tasks.get(id))) throw new Error('the task no longer exists')
          const deps = (a.dependsOn ?? []).map(idOf)
          if (deps.some((d) => !d)) throw new Error('a prerequisite was not created')
          await setDependencies(id, deps as string[])
          break
        }
        case 'set_sprint_note': {
          if (!(await db.sprints.get(a.sprintId!))) throw new Error('the sprint no longer exists')
          await setSprintNote(a.sprintId!, a.note ?? '')
          break
        }
      }
      applied++
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return { applied, error: `${a.verb} ${a.subject} failed: ${why}` }
    }
  }
  return { applied }
}
