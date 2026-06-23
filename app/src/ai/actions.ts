import {
  addMember,
  addSprintTask,
  db,
  memberNameExists,
  updateTask,
  type Member,
  type Priority,
  type Status,
  type Task,
} from '../db'
import type {
  AiAction,
  AiActionResult,
  AiRuntimeContext,
  CreateMemberAction,
  CreateMilestoneAction,
  CreateTaskAction,
  UpdateTaskAction,
} from './types'

const STATUSES: Status[] = ['todo', 'in_progress', 'done']
const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low', 'none']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function cleanNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return cleanString(value)
}

function cleanDate(value: unknown): string | null | undefined {
  const str = cleanNullableString(value)
  if (str == null) return str
  return ISO_DATE.test(str) ? str : undefined
}

function cleanNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function cleanStatus(value: unknown): Status | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return STATUSES.includes(normalized as Status) ? (normalized as Status) : undefined
}

function cleanPriority(value: unknown): Priority | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return PRIORITIES.includes(normalized as Priority) ? (normalized as Priority) : undefined
}

function cleanTaskSeq(value: unknown): number | null | undefined {
  if (value === null) return null
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function normalizeAction(raw: unknown): AiAction | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (type === 'create_task') {
    const title = cleanString(raw.title)
    if (!title) return null
    const action: CreateTaskAction = { type, title }
    const assigneeName = cleanNullableString(raw.assigneeName)
    const status = cleanStatus(raw.status)
    const priority = cleanPriority(raw.priority)
    const estimate = cleanNumber(raw.estimate)
    const startDate = cleanDate(raw.startDate)
    const dueDate = cleanDate(raw.dueDate)
    if (assigneeName !== undefined) action.assigneeName = assigneeName
    if (status) action.status = status
    if (priority) action.priority = priority
    if (estimate !== undefined) action.estimate = estimate
    if (startDate !== undefined) action.startDate = startDate
    if (dueDate !== undefined) action.dueDate = dueDate
    return action
  }
  if (type === 'create_milestone') {
    const title = cleanString(raw.title)
    if (!title) return null
    const action: CreateMilestoneAction = { type, title }
    const date = cleanDate(raw.date)
    const assigneeName = cleanNullableString(raw.assigneeName)
    const priority = cleanPriority(raw.priority)
    if (date !== undefined) action.date = date
    if (assigneeName !== undefined) action.assigneeName = assigneeName
    if (priority) action.priority = priority
    return action
  }
  if (type === 'update_task') {
    const action: UpdateTaskAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    const title = cleanString(raw.title)
    const assigneeName = cleanNullableString(raw.assigneeName)
    const status = cleanStatus(raw.status)
    const priority = cleanPriority(raw.priority)
    const estimate = cleanNumber(raw.estimate)
    const startDate = cleanDate(raw.startDate)
    const dueDate = cleanDate(raw.dueDate)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    if (title) action.title = title
    if (assigneeName !== undefined) action.assigneeName = assigneeName
    if (status) action.status = status
    if (priority) action.priority = priority
    if (estimate !== undefined) action.estimate = estimate
    if (startDate !== undefined) action.startDate = startDate
    if (dueDate !== undefined) action.dueDate = dueDate
    return action.taskSeq || action.taskTitle ? action : null
  }
  if (type === 'create_member') {
    const name = cleanString(raw.name)
    if (!name) return null
    const action: CreateMemberAction = { type, name }
    const title = cleanNullableString(raw.title)
    if (title !== undefined) action.title = title
    return action
  }
  return null
}

export function normalizeAiActions(raw: unknown): AiAction[] {
  const list = Array.isArray(raw) ? raw : []
  return list.map(normalizeAction).filter((a): a is AiAction => a !== null).slice(0, 8)
}

function findMemberByName(name: string | null | undefined, members: Member[]): Member | null {
  if (!name) return null
  const q = name.trim().toLowerCase()
  return members.find((m) => m.name.toLowerCase() === q) ?? null
}

function findTask(action: UpdateTaskAction, tasks: Task[]): Task | null {
  if (action.taskSeq) {
    const bySeq = tasks.find((t) => t.sequence === action.taskSeq)
    if (bySeq) return bySeq
  }
  const title = action.taskTitle?.trim().toLowerCase()
  if (!title) return null
  return (
    tasks.find((t) => t.title.toLowerCase() === title) ??
    tasks.find((t) => t.title.toLowerCase().includes(title)) ??
    null
  )
}

function assigneeLabel(name: string | null | undefined) {
  if (name === null) return 'Unassigned'
  return name ? name : 'unchanged assignee'
}

export function describeAiAction(action: AiAction, ctx: AiRuntimeContext): string {
  if (action.type === 'create_task') {
    return `Create task “${action.title}”${action.assigneeName ? ` for ${action.assigneeName}` : ''}`
  }
  if (action.type === 'create_milestone') {
    return `Create milestone “${action.title}”${action.date ? ` on ${action.date}` : ''}`
  }
  if (action.type === 'create_member') {
    return `Create member “${action.name}”${action.title ? ` · ${action.title}` : ''}`
  }
  const task = findTask(action, ctx.tasks)
  const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
  const changes = [
    action.title ? `title → “${action.title}”` : null,
    action.status ? `status → ${action.status}` : null,
    action.priority ? `priority → ${action.priority}` : null,
    action.estimate !== undefined ? `effort → ${action.estimate ?? 'not estimated'}` : null,
    action.startDate !== undefined ? `start → ${action.startDate ?? 'clear'}` : null,
    action.dueDate !== undefined ? `due → ${action.dueDate ?? 'clear'}` : null,
    action.assigneeName !== undefined ? `assignee → ${assigneeLabel(action.assigneeName)}` : null,
  ].filter(Boolean)
  return `Update ${target}: ${changes.join(', ') || 'no valid changes'}`
}

export async function executeAiActions(
  actions: AiAction[],
  ctx: AiRuntimeContext
): Promise<AiActionResult[]> {
  const results: AiActionResult[] = []
  if (!ctx.project) {
    return [{ ok: false, label: 'No project selected' }]
  }

  for (const action of actions) {
    try {
      if (action.type === 'create_member') {
        if (await memberNameExists(ctx.project.id, action.name)) {
          results.push({ ok: false, label: `Member already exists: ${action.name}` })
          continue
        }
        const member = await addMember(ctx.project.id, action.name)
        if (action.title) await db.members.update(member.id, { title: action.title })
        results.push({ ok: true, label: `Created member “${member.name}”` })
        continue
      }

      if (!ctx.sprint) {
        results.push({ ok: false, label: 'Select a sprint before applying sprint actions' })
        continue
      }

      if (action.type === 'create_task') {
        const assignee = findMemberByName(action.assigneeName, ctx.members)
        if (action.assigneeName && !assignee) {
          results.push({ ok: false, label: `Member not found: ${action.assigneeName}` })
          continue
        }
        const task = await addSprintTask({
          projectId: ctx.project.id,
          sprintId: ctx.sprint.id,
          title: action.title,
          startDate: action.startDate ?? ctx.sprint.startDate,
          assigneeId: assignee?.id ?? null,
          status: action.status,
          priority: action.priority,
        })
        const patch: Partial<Task> = {}
        if (action.estimate !== undefined) patch.estimate = action.estimate
        if (action.dueDate !== undefined) patch.dueDate = action.dueDate
        if (Object.keys(patch).length) await updateTask(task.id, patch)
        results.push({ ok: true, label: `Created task #${task.sequence} “${task.title}”` })
        continue
      }

      if (action.type === 'create_milestone') {
        const assignee = findMemberByName(action.assigneeName, ctx.members)
        if (action.assigneeName && !assignee) {
          results.push({ ok: false, label: `Member not found: ${action.assigneeName}` })
          continue
        }
        const date = action.date ?? ctx.sprint.startDate
        const task = await addSprintTask({
          projectId: ctx.project.id,
          sprintId: ctx.sprint.id,
          title: action.title,
          startDate: date,
          assigneeId: assignee?.id ?? null,
          priority: action.priority,
        })
        await updateTask(task.id, { estimate: 0, dueDate: date })
        results.push({ ok: true, label: `Created milestone #${task.sequence} “${task.title}”` })
        continue
      }

      const target = findTask(action, ctx.tasks)
      if (!target) {
        results.push({ ok: false, label: `Task not found for update` })
        continue
      }
      const patch: Partial<Task> = {}
      if (action.title) patch.title = action.title
      if (action.status) patch.status = action.status
      if (action.priority) patch.priority = action.priority
      if (action.estimate !== undefined) patch.estimate = action.estimate
      if (action.startDate !== undefined) patch.startDate = action.startDate
      if (action.dueDate !== undefined) patch.dueDate = action.dueDate
      if (action.assigneeName !== undefined) {
        if (action.assigneeName === null) patch.assigneeId = null
        else {
          const assignee = findMemberByName(action.assigneeName, ctx.members)
          if (!assignee) {
            results.push({ ok: false, label: `Member not found: ${action.assigneeName}` })
            continue
          }
          patch.assigneeId = assignee.id
        }
      }
      if (!Object.keys(patch).length) {
        results.push({ ok: false, label: `No valid changes for #${target.sequence}` })
        continue
      }
      await updateTask(target.id, patch)
      results.push({ ok: true, label: `Updated task #${target.sequence}` })
    } catch (err) {
      results.push({
        ok: false,
        label: describeAiAction(action, ctx),
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
