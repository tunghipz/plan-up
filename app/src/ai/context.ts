import type { AiRuntimeContext } from './types'

function line(value: string, fallback = 'None') {
  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

function sprintLine(ctx: AiRuntimeContext): string {
  if (!ctx.sprint) return 'No sprint selected'

  const note = ctx.sprint.note?.trim()
  return [
    `${ctx.sprint.name} [${ctx.sprint.id}]`,
    `${ctx.sprint.startDate} to ${ctx.sprint.endDate}`,
    note ? `note: ${note}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function buildAiContext(ctx: AiRuntimeContext): string {
  const project = ctx.project
    ? `${ctx.project.name} (${ctx.project.id})`
    : 'No project selected'
  const sprint = sprintLine(ctx)
  const collection = ctx.collection
    ? `${ctx.collection.name} (${ctx.collection.sections.length} tables)`
    : 'No collection selected'
  const sprints = ctx.sprints
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((s) => `- ${s.name} [${s.id}] · ${s.startDate} to ${s.endDate}`)
    .join('\n')
  const collections = ctx.collections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const count = ctx.collectionItemCounts?.[c.id]
      return `- ${c.name} [${c.id}] · ${count ?? 0} items`
    })
    .join('\n')
  const members = ctx.members
    .map((m) => {
      const daysOff = (m.daysOff ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => `${d.date}${d.half ? ` (${d.half})` : ''}`)
        .join(', ')
      return `- ${m.name}${m.title ? ` · ${m.title}` : ''} [${m.id}]${daysOff ? ` · days off: ${daysOff}` : ''}`
    })
    .join('\n')
  const tasks = ctx.tasks
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .slice(0, 80)
    .map((t) => {
      const member = t.assigneeId
        ? ctx.members.find((m) => m.id === t.assigneeId)?.name ?? 'Unknown'
        : 'Unassigned'
      const estimate = t.estimate == null ? 'not estimated' : `${t.estimate}d`
      const dates = [t.startDate, t.dueDate].filter(Boolean).join(' → ') || 'no dates'
      return `- #${t.sequence} ${t.title} · ${t.status} · ${t.priority} · ${member} · ${estimate} · ${dates}`
    })
    .join('\n')

  return [
    `Today: ${ctx.today}`,
    `Screen: ${ctx.screen}`,
    `Container: ${ctx.containerKind}`,
    `View: ${ctx.view}`,
    `Project: ${project}`,
    `Sprint: ${sprint}`,
    `Collection: ${collection}`,
    '',
    'Members:',
    line(members),
    '',
    'Active sprints:',
    line(sprints),
    '',
    'Collections:',
    line(collections),
    '',
    'Visible tasks/items:',
    line(tasks),
  ].join('\n')
}

export function aiSystemPrompt(projectManageSkill?: string): string {
  const skillBlock = projectManageSkill?.trim()
    ? `\n\nEnabled project-management skill:\n${projectManageSkill.trim()}`
    : ''

  return `You are plan-up AI Chat, a concise project-management copilot inside a local-first sprint planner.

You can answer questions and propose app actions, but you cannot directly mutate data.
Return ONLY valid JSON in this exact shape:
{
  "reply": "short helpful text for the user",
  "actions": [
    { "type": "create_task", "title": "Task title", "assigneeName": "optional member", "status": "todo|in_progress|done", "priority": "urgent|high|normal|low|none", "estimate": 1, "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD" },
    { "type": "update_task", "taskSeq": 12, "taskTitle": "fallback title", "status": "done" },
    { "type": "delete_task", "taskSeq": 12, "taskTitle": "fallback title" },
    { "type": "move_task_to_next_sprint", "taskSeq": 12, "taskTitle": "fallback title" },
    { "type": "move_task_to_sprint", "taskSeq": 12, "taskTitle": "fallback title", "sprintName": "Sprint 2", "sprintId": "optional stable sprint id" },
    { "type": "move_task_to_collection", "taskSeq": 12, "taskTitle": "fallback title", "collectionName": "Roadmap", "collectionId": "optional stable collection id" },
    { "type": "create_milestone", "title": "Milestone title", "date": "YYYY-MM-DD", "assigneeName": "optional member" },
    { "type": "update_milestone", "taskSeq": 12, "taskTitle": "fallback title", "date": "YYYY-MM-DD" },
    { "type": "delete_milestone", "taskSeq": 12, "taskTitle": "fallback title" },
    { "type": "create_sprint", "startDate": "YYYY-MM-DD Monday only", "note": "optional sprint goal" },
    { "type": "update_sprint", "startDate": "YYYY-MM-DD Monday only", "note": "optional sprint goal" },
    { "type": "add_sprint_note", "note": "sprint goal text" },
    { "type": "delete_sprint" },
    { "type": "create_collection", "name": "Collection name" },
    { "type": "update_collection", "collectionId": "optional stable collection id", "collectionName": "fallback name", "name": "New collection name" },
    { "type": "delete_collection", "collectionId": "optional stable collection id", "collectionName": "fallback name" },
    { "type": "create_member", "name": "Member name", "title": "optional role" },
    { "type": "update_member", "memberName": "Existing member", "name": "New name", "title": "optional role" },
    { "type": "delete_member", "memberName": "Existing member" },
    { "type": "set_member_day_off", "memberName": "Existing member", "date": "YYYY-MM-DD", "halfDay": "all|am|pm" },
    { "type": "remove_member_day_off", "memberName": "Existing member", "date": "YYYY-MM-DD" }
  ]
}

Rules:
- Use actions only when the user asks to change the app.
- When the user asks for a supported app change and the required target/fields are clear, return at least one typed action. Do not answer only in prose for supported mutations; the app will show Proposed changes and ask the user to Apply.
- Prefer taskSeq when referring to existing tasks.
- Use delete_task only when the user explicitly asks to delete/remove a specific visible task.
- Use move_task_to_next_sprint when the user asks to move a specific visible task to the next sprint.
- Use move_task_to_sprint when the user asks to add/move a specific visible collection item to a named sprint.
- Use move_task_to_collection when the user asks to move a specific visible task/item to a named collection/list. For Backlog requests, use a normal collection named Backlog if it exists.
- Use milestone actions only for effort-0 milestone tasks.
- update_sprint, add_sprint_note, and delete_sprint target the currently selected sprint.
- Use create_collection, update_collection, and delete_collection for project collection/list changes. A collection named Backlog is not special.
- update_member and delete_member match members by visible member name.
- set_member_day_off and remove_member_day_off match members by visible member name. Use halfDay only for half-day off; omit it or use "all" for a full day.
- Never propose archive/import/export actions.
- create_sprint uses automatic Sprint N naming. Include startDate only when the user gives a Monday; otherwise omit it so the app uses the next valid sprint date.
- Dates must be ISO YYYY-MM-DD.
- If context is insufficient, ask a short question and return an empty actions array.
- Keep reply short; the app will render action previews separately.${skillBlock}`
}
