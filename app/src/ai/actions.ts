import {
  addMember,
  addSprintTask,
  createCollection,
  createSprint,
  db,
  deleteCollection,
  deleteMember,
  deleteSprint,
  deleteTask,
  isBacklogCollection,
  memberNameExists,
  moveTaskToBacklog,
  moveTaskToCollection,
  moveTaskToNextSprint,
  moveTaskToSprint,
  renameCollection,
  setMemberDaysOff,
  updateSprint,
  updateTask,
  type Collection,
  type DayOff,
  type Member,
  type Priority,
  type Sprint,
  type Status,
  type Task,
} from '../db'
import type {
  AiAction,
  AiActionResult,
  AiRuntimeContext,
  AddSprintNoteAction,
  CreateSprintAction,
  CreateCollectionAction,
  DeleteCollectionAction,
  DeleteMemberAction,
  DeleteMilestoneAction,
  DeleteSprintAction,
  CreateMemberAction,
  CreateMilestoneAction,
  CreateTaskAction,
  DeleteTaskAction,
  MoveTaskToBacklogAction,
  MoveTaskToCollectionAction,
  MoveTaskToNextSprintAction,
  MoveTaskToSprintAction,
  RemoveMemberDayOffAction,
  SetMemberDayOffAction,
  UpdateMemberAction,
  UpdateCollectionAction,
  UpdateMilestoneAction,
  UpdateSprintAction,
  UpdateTaskAction,
} from './types'

const STATUSES: Status[] = ['todo', 'in_progress', 'done']
const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low', 'none']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_AI_ACTIONS = 100

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

function cleanHalfDay(value: unknown): 'all' | 'am' | 'pm' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['all', 'full', 'day', 'full_day', 'full-day'].includes(normalized)) return 'all'
  if (['am', 'morning'].includes(normalized)) return 'am'
  if (['pm', 'afternoon'].includes(normalized)) return 'pm'
  return undefined
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
  if (type === 'update_milestone') {
    const action: UpdateMilestoneAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    const title = cleanString(raw.title)
    const date = cleanDate(raw.date)
    const assigneeName = cleanNullableString(raw.assigneeName)
    const priority = cleanPriority(raw.priority)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    if (title) action.title = title
    if (date !== undefined) action.date = date
    if (assigneeName !== undefined) action.assigneeName = assigneeName
    if (priority) action.priority = priority
    return action.taskSeq || action.taskTitle ? action : null
  }
  if (type === 'delete_milestone') {
    const action: DeleteMilestoneAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    return action.taskSeq || action.taskTitle ? action : null
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
  if (type === 'delete_task') {
    const action: DeleteTaskAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    return action.taskSeq || action.taskTitle ? action : null
  }
  if (type === 'move_task_to_next_sprint') {
    const action: MoveTaskToNextSprintAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    return action.taskSeq || action.taskTitle ? action : null
  }
  if (type === 'move_task_to_backlog') {
    const action: MoveTaskToBacklogAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    return action.taskSeq || action.taskTitle ? action : null
  }
  if (type === 'move_task_to_sprint') {
    const action: MoveTaskToSprintAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    const sprintId = cleanNullableString(raw.sprintId)
    const sprintName = cleanNullableString(raw.sprintName)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    if (sprintId !== undefined) action.sprintId = sprintId
    if (sprintName !== undefined) action.sprintName = sprintName
    return (action.taskSeq || action.taskTitle) && (action.sprintId || action.sprintName)
      ? action
      : null
  }
  if (type === 'move_task_to_collection') {
    const action: MoveTaskToCollectionAction = { type }
    const taskSeq = cleanTaskSeq(raw.taskSeq)
    const taskTitle = cleanNullableString(raw.taskTitle)
    const collectionId = cleanNullableString(raw.collectionId)
    const collectionName = cleanNullableString(raw.collectionName)
    if (taskSeq !== undefined) action.taskSeq = taskSeq
    if (taskTitle !== undefined) action.taskTitle = taskTitle
    if (collectionId !== undefined) action.collectionId = collectionId
    if (collectionName !== undefined) action.collectionName = collectionName
    return (action.taskSeq || action.taskTitle) && (action.collectionId || action.collectionName)
      ? action
      : null
  }
  if (type === 'create_sprint') {
    const action: CreateSprintAction = { type }
    const startDate = cleanDate(raw.startDate)
    const note = cleanNullableString(raw.note)
    if (startDate !== undefined) action.startDate = startDate
    if (note !== undefined) action.note = note
    return action
  }
  if (type === 'update_sprint') {
    const action: UpdateSprintAction = { type }
    const startDate = cleanDate(raw.startDate)
    const note = cleanNullableString(raw.note)
    if (startDate !== undefined) action.startDate = startDate
    if (note !== undefined) action.note = note
    return action.startDate !== undefined || action.note !== undefined ? action : null
  }
  if (type === 'add_sprint_note') {
    const note = cleanString(raw.note)
    return note ? ({ type, note } satisfies AddSprintNoteAction) : null
  }
  if (type === 'delete_sprint') {
    return { type } satisfies DeleteSprintAction
  }
  if (type === 'create_collection') {
    const name = cleanString(raw.name)
    return name ? ({ type, name } satisfies CreateCollectionAction) : null
  }
  if (type === 'update_collection') {
    const name = cleanString(raw.name)
    if (!name) return null
    const action: UpdateCollectionAction = { type, name }
    const collectionId = cleanNullableString(raw.collectionId)
    const collectionName = cleanNullableString(raw.collectionName)
    if (collectionId !== undefined) action.collectionId = collectionId
    if (collectionName !== undefined) action.collectionName = collectionName
    return action
  }
  if (type === 'delete_collection') {
    const action: DeleteCollectionAction = { type }
    const collectionId = cleanNullableString(raw.collectionId)
    const collectionName = cleanNullableString(raw.collectionName)
    if (collectionId !== undefined) action.collectionId = collectionId
    if (collectionName !== undefined) action.collectionName = collectionName
    return action
  }
  if (type === 'create_member') {
    const name = cleanString(raw.name)
    if (!name) return null
    const action: CreateMemberAction = { type, name }
    const title = cleanNullableString(raw.title)
    if (title !== undefined) action.title = title
    return action
  }
  if (type === 'update_member') {
    const memberName = cleanString(raw.memberName)
    if (!memberName) return null
    const action: UpdateMemberAction = { type, memberName }
    const name = cleanString(raw.name)
    const title = cleanNullableString(raw.title)
    if (name) action.name = name
    if (title !== undefined) action.title = title
    return action.name || action.title !== undefined ? action : null
  }
  if (type === 'delete_member') {
    const memberName = cleanString(raw.memberName)
    return memberName ? ({ type, memberName } satisfies DeleteMemberAction) : null
  }
  if (type === 'set_member_day_off') {
    const memberName = cleanString(raw.memberName)
    const date = cleanDate(raw.date)
    if (!memberName || !date) return null
    const action: SetMemberDayOffAction = { type, memberName, date }
    const halfDay = cleanHalfDay(raw.halfDay ?? raw.half)
    if (halfDay) action.halfDay = halfDay
    return action
  }
  if (type === 'remove_member_day_off') {
    const memberName = cleanString(raw.memberName)
    const date = cleanDate(raw.date)
    return memberName && date ? ({ type, memberName, date } satisfies RemoveMemberDayOffAction) : null
  }
  return null
}

export function normalizeAiActions(raw: unknown): AiAction[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map(normalizeAction)
    .filter((a): a is AiAction => a !== null)
    .slice(0, MAX_AI_ACTIONS)
}

function findMemberByName(name: string | null | undefined, members: Member[]): Member | null {
  if (!name) return null
  const q = name.trim().toLowerCase()
  return members.find((m) => m.name.toLowerCase() === q) ?? null
}

function findTask(
  action: Pick<UpdateTaskAction | DeleteTaskAction, 'taskSeq' | 'taskTitle'>,
  tasks: Task[]
): Task | null {
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

function findSprint(action: MoveTaskToSprintAction, sprints: Sprint[]): Sprint | null {
  if (action.sprintId) {
    const byId = sprints.find((s) => s.id === action.sprintId)
    if (byId) return byId
  }
  const name = action.sprintName?.trim().toLowerCase()
  if (!name) return null
  return (
    sprints.find((s) => s.name.toLowerCase() === name) ??
    sprints.find((s) => s.name.toLowerCase().includes(name)) ??
    null
  )
}

function findCollection(
  action: { collectionId?: string | null; collectionName?: string | null },
  ctx: AiRuntimeContext
): Collection | null {
  if (action.collectionId) {
    const byId = ctx.collections.find((c) => c.id === action.collectionId)
    if (byId) return byId
  }
  const name = action.collectionName?.trim().toLowerCase()
  if (name) {
    return (
      ctx.collections.find((c) => c.name.toLowerCase() === name) ??
      ctx.collections.find((c) => c.name.toLowerCase().includes(name)) ??
      null
    )
  }
  return ctx.collection
}

function collectionNameExists(name: string, ctx: AiRuntimeContext, excludeId?: string): boolean {
  const q = name.trim().toLowerCase()
  return ctx.collections.some(
    (collection) => collection.id !== excludeId && collection.name.trim().toLowerCase() === q
  )
}

function findMilestone(
  action: Pick<UpdateMilestoneAction | DeleteMilestoneAction, 'taskSeq' | 'taskTitle'>,
  tasks: Task[]
): Task | null {
  const target = findTask(action, tasks)
  return target?.estimate === 0 ? target : null
}

function assigneeLabel(name: string | null | undefined) {
  if (name === null) return 'Unassigned'
  return name ? name : 'unchanged assignee'
}

function dayOffLabel(halfDay: 'all' | 'am' | 'pm' | undefined) {
  if (halfDay === 'am') return 'AM off'
  if (halfDay === 'pm') return 'PM off'
  return 'off all day'
}

export function describeAiAction(action: AiAction, ctx: AiRuntimeContext): string {
  if (action.type === 'create_task') {
    return `Create task “${action.title}”${action.assigneeName ? ` for ${action.assigneeName}` : ''}`
  }
  if (action.type === 'create_milestone') {
    return `Create milestone “${action.title}”${action.date ? ` on ${action.date}` : ''}`
  }
  if (action.type === 'update_milestone') {
    const task = findMilestone(action, ctx.tasks)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    const changes = [
      action.title ? `title → “${action.title}”` : null,
      action.date !== undefined ? `date → ${action.date ?? 'clear'}` : null,
      action.priority ? `priority → ${action.priority}` : null,
      action.assigneeName !== undefined ? `assignee → ${assigneeLabel(action.assigneeName)}` : null,
    ].filter(Boolean)
    return `Update milestone ${target}: ${changes.join(', ') || 'no valid changes'}`
  }
  if (action.type === 'delete_milestone') {
    const task = findMilestone(action, ctx.tasks)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Delete milestone ${target}`
  }
  if (action.type === 'create_member') {
    return `Create member “${action.name}”${action.title ? ` · ${action.title}` : ''}`
  }
  if (action.type === 'update_member') {
    const changes = [
      action.name ? `name → “${action.name}”` : null,
      action.title !== undefined ? `title → ${action.title || 'clear'}` : null,
    ].filter(Boolean)
    return `Update member “${action.memberName}”: ${changes.join(', ') || 'no valid changes'}`
  }
  if (action.type === 'delete_member') {
    return `Delete member “${action.memberName}”`
  }
  if (action.type === 'set_member_day_off') {
    return `Set ${action.memberName} ${dayOffLabel(action.halfDay)} on ${action.date}`
  }
  if (action.type === 'remove_member_day_off') {
    return `Remove day off for ${action.memberName} on ${action.date}`
  }
  if (action.type === 'create_sprint') {
    return `Create sprint${action.startDate ? ` starting ${action.startDate}` : ''}${action.note ? ` · ${action.note}` : ''}`
  }
  if (action.type === 'update_sprint') {
    const target = ctx.sprint?.name ?? 'selected sprint'
    const changes = [
      action.startDate !== undefined ? `start → ${action.startDate ?? 'unchanged'}` : null,
      action.note !== undefined ? `note → ${action.note || 'clear'}` : null,
    ].filter(Boolean)
    return `Update ${target}: ${changes.join(', ') || 'no valid changes'}`
  }
  if (action.type === 'add_sprint_note') {
    return `Add sprint note to ${ctx.sprint?.name ?? 'selected sprint'}: “${action.note}”`
  }
  if (action.type === 'delete_sprint') {
    return `Delete ${ctx.sprint?.name ?? 'selected sprint'}`
  }
  if (action.type === 'create_collection') {
    return `Create collection “${action.name}”`
  }
  if (action.type === 'update_collection') {
    const collection = findCollection(action, ctx)
    return `Rename collection ${collection ? `“${collection.name}”` : action.collectionName ? `“${action.collectionName}”` : 'selected collection'} to “${action.name}”`
  }
  if (action.type === 'delete_collection') {
    const collection = findCollection(action, ctx)
    return `Delete collection ${collection ? `“${collection.name}”` : action.collectionName ? `“${action.collectionName}”` : 'selected collection'}`
  }
  if (action.type === 'delete_task') {
    const task = findTask(action, ctx.tasks)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Delete task ${target}`
  }
  if (action.type === 'move_task_to_next_sprint') {
    const task = findTask(action, ctx.tasks)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Move task ${target} to next sprint`
  }
  if (action.type === 'move_task_to_backlog') {
    const task = findTask(action, ctx.tasks)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Move task ${target} to Backlog`
  }
  if (action.type === 'move_task_to_sprint') {
    const task = findTask(action, ctx.tasks)
    const sprint = findSprint(action, ctx.sprints)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Move task ${target} to ${sprint?.name ?? action.sprintName ?? action.sprintId ?? 'selected sprint'}`
  }
  if (action.type === 'move_task_to_collection') {
    const task = findTask(action, ctx.tasks)
    const collection = findCollection(action, ctx)
    const target = task ? `#${task.sequence} “${task.title}”` : action.taskSeq ? `#${action.taskSeq}` : `“${action.taskTitle}”`
    return `Move task ${target} to collection ${collection?.name ?? action.collectionName ?? action.collectionId ?? 'selected collection'}`
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

      if (action.type === 'update_member') {
        const member = findMemberByName(action.memberName, ctx.members)
        if (!member) {
          results.push({ ok: false, label: `Member not found: ${action.memberName}` })
          continue
        }
        if (action.name && await memberNameExists(ctx.project.id, action.name, member.id)) {
          results.push({ ok: false, label: `Member already exists: ${action.name}` })
          continue
        }
        const patch: Partial<Member> = {}
        if (action.name) patch.name = action.name
        if (action.title !== undefined) patch.title = action.title ?? ''
        await db.members.update(member.id, patch)
        results.push({ ok: true, label: `Updated member “${member.name}”` })
        continue
      }

      if (action.type === 'delete_member') {
        const member = findMemberByName(action.memberName, ctx.members)
        if (!member) {
          results.push({ ok: false, label: `Member not found: ${action.memberName}` })
          continue
        }
        await deleteMember(member.id)
        results.push({ ok: true, label: `Deleted member “${member.name}”` })
        continue
      }

      if (action.type === 'set_member_day_off') {
        const member = findMemberByName(action.memberName, ctx.members)
        if (!member) {
          results.push({ ok: false, label: `Member not found: ${action.memberName}` })
          continue
        }
        const next: DayOff[] = (member.daysOff ?? []).filter((d) => d.date !== action.date)
        next.push(
          action.halfDay === 'am' || action.halfDay === 'pm'
            ? { date: action.date, half: action.halfDay }
            : { date: action.date }
        )
        await setMemberDaysOff(member.id, next)
        results.push({
          ok: true,
          label: `Set ${member.name} ${dayOffLabel(action.halfDay)} on ${action.date}`,
        })
        continue
      }

      if (action.type === 'remove_member_day_off') {
        const member = findMemberByName(action.memberName, ctx.members)
        if (!member) {
          results.push({ ok: false, label: `Member not found: ${action.memberName}` })
          continue
        }
        const current = member.daysOff ?? []
        if (!current.some((d) => d.date === action.date)) {
          results.push({ ok: false, label: `${member.name} has no day off on ${action.date}` })
          continue
        }
        await setMemberDaysOff(
          member.id,
          current.filter((d) => d.date !== action.date)
        )
        results.push({ ok: true, label: `Removed ${member.name} day off on ${action.date}` })
        continue
      }

      if (action.type === 'create_sprint') {
        const sprint = await createSprint({
          projectId: ctx.project.id,
          startDate: action.startDate,
          note: action.note,
          today: ctx.today,
        })
        results.push({ ok: true, label: `Created ${sprint.name}` })
        continue
      }

      if (action.type === 'update_sprint') {
        if (!ctx.sprint) {
          results.push({ ok: false, label: 'Select a sprint before updating it' })
          continue
        }
        const sprint = await updateSprint({
          sprintId: ctx.sprint.id,
          startDate: action.startDate ?? ctx.sprint.startDate,
          note: action.note !== undefined ? action.note : ctx.sprint.note,
        })
        results.push({
          ok: !!sprint,
          label: sprint ? `Updated ${sprint.name}` : 'Sprint not found for update',
        })
        continue
      }

      if (action.type === 'add_sprint_note') {
        if (!ctx.sprint) {
          results.push({ ok: false, label: 'Select a sprint before adding a note' })
          continue
        }
        const sprint = await updateSprint({
          sprintId: ctx.sprint.id,
          startDate: ctx.sprint.startDate,
          note: action.note,
        })
        results.push({
          ok: !!sprint,
          label: sprint ? `Updated ${sprint.name} note` : 'Sprint not found for note update',
        })
        continue
      }

      if (action.type === 'delete_sprint') {
        if (!ctx.sprint) {
          results.push({ ok: false, label: 'Select a sprint before deleting it' })
          continue
        }
        await deleteSprint(ctx.sprint.id)
        results.push({ ok: true, label: `Deleted ${ctx.sprint.name}` })
        continue
      }

      if (action.type === 'create_collection') {
        if (collectionNameExists(action.name, ctx)) {
          results.push({ ok: false, label: `Collection already exists: ${action.name}` })
          continue
        }
        const collection = await createCollection(ctx.project.id, action.name)
        results.push({ ok: true, label: `Created collection “${collection.name}”` })
        continue
      }

      if (action.type === 'update_collection') {
        const collection = findCollection(action, ctx)
        if (!collection) {
          results.push({ ok: false, label: 'Collection not found for update' })
          continue
        }
        if (isBacklogCollection(collection)) {
          results.push({ ok: false, label: 'Backlog cannot be renamed' })
          continue
        }
        if (collectionNameExists(action.name, ctx, collection.id)) {
          results.push({ ok: false, label: `Collection already exists: ${action.name}` })
          continue
        }
        await renameCollection(collection.id, action.name)
        results.push({ ok: true, label: `Renamed collection “${collection.name}” to “${action.name}”` })
        continue
      }

      if (action.type === 'delete_collection') {
        const collection = findCollection(action, ctx)
        if (!collection) {
          results.push({ ok: false, label: 'Collection not found for delete' })
          continue
        }
        if (isBacklogCollection(collection)) {
          results.push({ ok: false, label: 'Backlog cannot be deleted' })
          continue
        }
        await deleteCollection(collection.id)
        results.push({ ok: true, label: `Deleted collection “${collection.name}”` })
        continue
      }

      if (action.type === 'delete_task') {
        const target = findTask(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Task not found for delete' })
          continue
        }
        await deleteTask(target.id)
        results.push({ ok: true, label: `Deleted task #${target.sequence} “${target.title}”` })
        continue
      }

      if (action.type === 'move_task_to_next_sprint') {
        const target = findTask(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Task not found for move' })
          continue
        }
        const result = await moveTaskToNextSprint(target.id, ctx.sprint?.id)
        results.push({
          ok: result.moved,
          label: result.moved
            ? `Moved task #${target.sequence} to ${result.targetSprintName ?? 'next sprint'}`
            : 'No next active sprint found for move',
        })
        continue
      }

      if (action.type === 'move_task_to_backlog') {
        const target = findTask(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Task not found for backlog move' })
          continue
        }
        const result = await moveTaskToBacklog(target.id)
        results.push({
          ok: result.moved,
          label: result.moved
            ? `Moved task #${target.sequence} “${target.title}” to Backlog`
            : 'Task not found for backlog move',
        })
        continue
      }

      if (action.type === 'move_task_to_sprint') {
        const target = findTask(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Task not found for sprint move' })
          continue
        }
        const sprint = findSprint(action, ctx.sprints)
        if (!sprint) {
          results.push({
            ok: false,
            label: `Sprint not found: ${action.sprintName ?? action.sprintId ?? 'unknown'}`,
          })
          continue
        }
        const result = await moveTaskToSprint(target.id, sprint.id)
        results.push({
          ok: result.moved,
          label: result.moved
            ? `Moved task #${target.sequence} “${target.title}” to ${result.targetSprintName ?? sprint.name}`
            : `Could not move task #${target.sequence} to ${sprint.name}`,
        })
        continue
      }

      if (action.type === 'move_task_to_collection') {
        const target = findTask(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Task not found for collection move' })
          continue
        }
        const collection = findCollection(action, ctx)
        if (!collection) {
          results.push({
            ok: false,
            label: `Collection not found: ${action.collectionName ?? action.collectionId ?? 'unknown'}`,
          })
          continue
        }
        const result = await moveTaskToCollection(target.id, collection.id)
        results.push({
          ok: result.moved,
          label: result.moved
            ? `Moved task #${target.sequence} “${target.title}” to collection ${result.targetCollectionName ?? collection.name}`
            : `Could not move task #${target.sequence} to collection ${collection.name}`,
        })
        continue
      }

      if (action.type === 'delete_milestone') {
        const target = findMilestone(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Milestone not found for delete' })
          continue
        }
        await deleteTask(target.id)
        results.push({ ok: true, label: `Deleted milestone #${target.sequence} “${target.title}”` })
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

      if (action.type === 'update_milestone') {
        const target = findMilestone(action, ctx.tasks)
        if (!target) {
          results.push({ ok: false, label: 'Milestone not found for update' })
          continue
        }
        const patch: Partial<Task> = {}
        if (action.title) patch.title = action.title
        if (action.priority) patch.priority = action.priority
        if (action.date !== undefined) {
          patch.startDate = action.date
          patch.dueDate = action.date
        }
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
          results.push({ ok: false, label: `No valid changes for milestone #${target.sequence}` })
          continue
        }
        await updateTask(target.id, patch)
        results.push({ ok: true, label: `Updated milestone #${target.sequence}` })
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
