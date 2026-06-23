import type { AiRuntimeContext } from './types'

function line(value: string, fallback = 'None') {
  const trimmed = value.trim()
  return trimmed ? trimmed : fallback
}

export function buildAiContext(ctx: AiRuntimeContext): string {
  const project = ctx.project
    ? `${ctx.project.name} (${ctx.project.id})`
    : 'No project selected'
  const sprint = ctx.sprint
    ? `${ctx.sprint.name} · ${ctx.sprint.startDate} to ${ctx.sprint.endDate}`
    : 'No sprint selected'
  const collection = ctx.collection
    ? `${ctx.collection.name} (${ctx.collection.sections.length} tables)`
    : 'No collection selected'
  const members = ctx.members
    .map((m) => `- ${m.name}${m.title ? ` · ${m.title}` : ''} [${m.id}]`)
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
    { "type": "create_milestone", "title": "Milestone title", "date": "YYYY-MM-DD", "assigneeName": "optional member" },
    { "type": "create_member", "name": "Member name", "title": "optional role" }
  ]
}

Rules:
- Use actions only when the user asks to change the app.
- Prefer taskSeq when referring to existing tasks.
- Never propose delete/archive/import/export actions.
- Dates must be ISO YYYY-MM-DD.
- If context is insufficient, ask a short question and return an empty actions array.
- Keep reply short; the app will render action previews separately.${skillBlock}`
}
