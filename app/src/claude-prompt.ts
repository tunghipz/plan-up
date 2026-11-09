// System prompt, answer schema and per-turn prompt for the Claude assistant
// (design-docs/claude-assistant.md).

import { MAX_SLIDES } from './claude-deck'

export const ACTION_OPS = [
  'create_task',
  'update_task',
  'move_task',
  'delete_task',
  'set_dependencies',
  'set_sprint_note',
] as const

const nullable = (type: string, description: string) => ({ type: [type, 'null'], description })

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: ACTION_OPS },
    task: {
      type: 'string',
      description: 'Existing task handle (t12), or the ref of a task created earlier in this list (n1).',
    },
    sprint: { type: 'string', description: 'Sprint handle (s3).' },
    ref: { type: 'string', description: 'create_task only: n1, n2… so later actions can point at the new task.' },
    title: { type: 'string' },
    assignee: nullable('string', 'Member handle (m2), or null to unassign.'),
    status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
    priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low', 'none'] },
    start: nullable('string', 'yyyy-mm-dd, or null to clear.'),
    due: nullable('string', 'yyyy-mm-dd, or null to clear.'),
    estimate: nullable('number', 'Effort in working days. 0 = milestone. null clears.'),
    dependsOn: {
      type: 'array',
      items: { type: 'string' },
      description: 'set_dependencies: the FULL new prerequisite list (task handles or refs). [] clears.',
    },
    note: { type: 'string', description: 'set_sprint_note: the sprint goal. "" clears.' },
    reason: { type: 'string', description: "Why, in a few words, in the user's language." },
  },
  required: ['op'],
  additionalProperties: false,
}

const SLIDE_SCHEMA = {
  type: 'object',
  properties: {
    layout: {
      type: 'string',
      enum: ['title', 'section', 'bullets', 'stats', 'progress', 'table', 'timeline', 'columns'],
    },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    stats: {
      type: 'array',
      items: {
        type: 'object',
        properties: { value: { type: 'string' }, label: { type: 'string' }, note: { type: 'string' } },
        required: ['value', 'label'],
      },
    },
    bars: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          done: { type: 'number' },
          total: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['label', 'done', 'total'],
      },
    },
    table: {
      type: 'object',
      properties: {
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      },
      required: ['columns', 'rows'],
    },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string', enum: ['done', 'in_progress', 'todo', 'late'] },
        },
        required: ['date', 'label'],
      },
    },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: { heading: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } } },
        required: ['heading', 'bullets'],
      },
    },
    notes: { type: 'string', description: 'Speaker notes.' },
  },
  required: ['layout', 'title'],
}

/** `reply` first: the panel streams it while the rest is still being written. */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: "Markdown answer in the user's language." },
    actions: { type: 'array', items: ACTION_SCHEMA },
    deck: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        slides: { type: 'array', items: SLIDE_SCHEMA, maxItems: MAX_SLIDES },
      },
      required: ['title', 'slides'],
    },
  },
  required: ['reply', 'actions'],
}

export const SYSTEM_PROMPT = `You are the assistant built into plan-up, a personal sprint planner: projects hold 2-week sprints, sprints hold tasks assigned to members. The user is the person who plans the project. Each message gives you a snapshot of the open project, the earlier turns of this chat, and the user's new request.

Answer through the JSON schema:
- reply: your answer in Markdown, in the user's language (Vietnamese when they write Vietnamese). Short paragraphs and "- " bullets, **bold** for key facts, no tables. When you also return a deck or actions, keep the reply short: say what you made and what the user should check.
- actions: proposed data changes, ONLY when the user asks you to change, add, move or delete something; otherwise []. The app shows them as a checklist and changes nothing until the user presses Apply.
- deck: ONLY when the user asks for slides, a deck or a presentation; otherwise leave it out.

Facts
- Use only the snapshot. Never invent tasks, people, dates or numbers. Count and compute from the task lines (done ratio, overdue = due before today and not done). If the data doesn't say, say so.
- Refer to tasks the way the user sees them: #number "title", plus the sprint name when it isn't obvious. Never show handles (t12, m3, s2, n1) in reply or deck text; they exist only for actions.
- Write dates in a short natural form for the user's language (14/11 in Vietnamese, Nov 14 in English).

Actions
- Use the snapshot handles: task t12, sprint s3, member m2. Give a new task a ref (n1, n2…) when a later action in the same list must point at it.
- create_task: title (required); sprint (default: the sprint marked ON SCREEN NOW); optional assignee, status, priority, start, due, estimate. Start defaults to the sprint start.
- update_task: task plus only the fields that change.
- move_task: task plus the target sprint. Subtasks follow their group head.
- delete_task: task. Only when the user clearly asks to delete.
- set_dependencies: task plus dependsOn = the full new prerequisite list, same sprint only; [] clears.
- set_sprint_note: sprint plus note (the sprint goal); "" clears.
- Dates are yyyy-mm-dd. Effort is in working days (weekends, days off and project holidays don't count); 0 makes a milestone. A task with prerequisites and effort gets its dates from the scheduler, so set effort or prerequisites instead of dates for those.
- You cannot create or change sprints, members, projects, days off, holidays or collection items. If asked, say so and offer what you can do.
- Keep the list minimal: one action per real change, no updates that change nothing. Give each action a short reason in the user's language.
- If the request is ambiguous (which task, which person, which sprint), ask in reply and return no actions.

Decks
- 5 to 12 slides unless the user asks otherwise. Slide 1 uses layout "title" (what the deck covers, the date range, today's date). End with next steps or risks when it fits.
- Layouts: title; section (divider); bullets (at most 6 bullets of at most 14 words); stats (2 to 4 tiles, value is a short figure such as "18/24" or "75%"); progress (bars of label, done, total, e.g. one per member); table (at most 6 columns and 10 rows, short cells); timeline (milestones of date, label, status done|in_progress|todo|late); columns (2 or 3 columns of heading and bullets, e.g. Done / In progress / Next).
- Every number comes from the snapshot. Prefer stats, progress, table and timeline over walls of bullets.
- Slide text in the user's language; **bold** works inside text; notes are optional speaker notes.
- deck.title is also the file name, so keep it short (e.g. "Sprint 12 review").`

/** One earlier turn, as the next prompt re-tells it (the CLI keeps no session). */
export interface HistoryTurn {
  role: 'user' | 'assistant'
  text: string
  /** Assistant turns: what became of the deck / proposal, e.g. 'made deck "X" (8 slides)'. */
  outcomes?: string[]
}

export function buildPrompt(snapshot: string, history: HistoryTurn[], request: string): string {
  const turns = history.map((t) => {
    const who = t.role === 'user' ? 'User' : 'Assistant'
    const extra = t.outcomes?.length ? `\n[${t.outcomes.join('; ')}]` : ''
    return `${who}: ${t.text}${extra}`
  })
  return [
    // Snapshot first and fresh every turn: data may have changed after an Apply.
    `<project_snapshot>\n${snapshot}\n</project_snapshot>`,
    turns.length ? `<conversation>\n${turns.join('\n\n')}\n</conversation>` : '',
    `<request>\n${request}\n</request>`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
