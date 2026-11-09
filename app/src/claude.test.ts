import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  db,
  addSprintTask,
  moveTasksToSprint,
  projectPlanSignature,
  restoreProjectPlan,
  snapshotProjectPlan,
  updateTask,
  type Member,
  type Sprint,
  type Task,
} from './db'
import { buildContext, loadContextData, ARCHIVED_TASK_CAP } from './claude-context'
import { applyActions, resolveActions, summarizeActions } from './claude-actions'
import { deckFileName, escapeHtml, renderDeckHtml, sanitizeDeck, slideZoom } from './claude-deck'
import { buildPrompt } from './claude-prompt'
import { readPartialJsonString, describeClaudeError, CLAUDE_NOT_FOUND } from './claude-run'

const P = 'claude-project'
const TODAY = '2026-11-09'

let s1: Sprint
let s2: Sprint
let an: Member
let binh: Member

async function seed() {
  await db.transaction('rw', [db.projects, db.members, db.sprints, db.tasks, db.events], async () => {
    await db.tasks.clear()
    await db.sprints.clear()
    await db.members.clear()
    await db.projects.clear()
    await db.events.clear()
    await db.projects.add({ id: P, name: 'Plan Up', createdAt: 0, description: 'Sprint planner' })
  })
  an = { id: 'mA', projectId: P, name: 'An', color: '#000', daysOff: [{ date: '2026-11-12' }], title: 'Backend', order: 0 }
  binh = { id: 'mB', projectId: P, name: 'Bình', color: '#000', daysOff: [], order: 1 }
  await db.members.bulkAdd([an, binh])
  s1 = { id: 'S1', projectId: P, name: 'Sprint 1', startDate: '2026-11-02', endDate: '2026-11-15' }
  s2 = { id: 'S2', projectId: P, name: 'Sprint 2', startDate: '2026-11-16', endDate: '2026-11-29' }
  await db.sprints.bulkAdd([s1, s2])
}

async function task(title: string, patch: Partial<Task> = {}, sprint: Sprint = s1): Promise<Task> {
  const t = await addSprintTask({ projectId: P, sprintId: sprint.id, title, startDate: sprint.startDate })
  if (Object.keys(patch).length) await db.tasks.update(t.id, patch)
  return (await db.tasks.get(t.id))!
}

async function context() {
  const data = (await loadContextData(P, s1.id, TODAY))!
  return { data, ctx: buildContext(data) }
}

beforeEach(seed)

describe('readPartialJsonString', () => {
  it('reads a value that is still streaming', () => {
    expect(readPartialJsonString('{"reply": "Xin ch', 'reply')).toBe('Xin ch')
    expect(readPartialJsonString('{"reply": "done", "actions": []}', 'reply')).toBe('done')
  })
  it('returns null before the value opens', () => {
    expect(readPartialJsonString('{"rep', 'reply')).toBeNull()
    expect(readPartialJsonString('{"reply": ', 'reply')).toBeNull()
  })
  it('decodes escapes and stops before a cut-off one', () => {
    expect(readPartialJsonString('{"reply": "a\\nb \\"q\\" \\u00e0', 'reply')).toBe('a\nb "q" à')
    expect(readPartialJsonString('{"reply": "a\\', 'reply')).toBe('a')
    expect(readPartialJsonString('{"reply": "a\\u00', 'reply')).toBe('a')
  })
})

describe('describeClaudeError', () => {
  it('explains a missing CLI and a missing login', () => {
    expect(describeClaudeError(CLAUDE_NOT_FOUND)).toMatch(/isn't installed/)
    expect(describeClaudeError('OAuth session expired')).toMatch(/isn't logged in/)
    expect(describeClaudeError('You hit your limit')).toBe('You hit your limit')
  })
})

describe('buildContext', () => {
  it('lists members, sprints and tasks with handles and flags', async () => {
    const a = await task('**Login** API', { assigneeId: an.id, status: 'done', estimate: 2 })
    await task('Payment', { assigneeId: binh.id, dueDate: '2026-11-05', dependsOn: [a.id] })
    await task('Next sprint work', {}, s2)
    const { ctx } = await context()
    expect(ctx.text).toContain('Today: 2026-11-09 (Monday)')
    expect(ctx.text).toContain('m1 "An" · role "Backend" · days off: 2026-11-12')
    expect(ctx.text).toContain('s1 "Sprint 1" · 2026-11-02 → 2026-11-15 · ON SCREEN NOW · running')
    expect(ctx.text).toContain('t1 #1 "Login API" · done · m1 An')
    expect(ctx.text).toMatch(/t2 #2 "Payment" · todo · m2 Bình · 2026-11-02 → 2026-11-05 · OVERDUE, after t1/)
    expect(ctx.text).toContain('s2 "Sprint 2"')
    expect(ctx.taskCount).toBe(3)
    expect(ctx.handles.task.get('t1')).toBe(a.id)
    expect(ctx.handles.member.get('m2')).toBe(binh.id)
  })

  it('keeps only counts for archived sprints past the cap', async () => {
    await db.sprints.update(s2.id, { archivedAt: 1 })
    const rows: Task[] = Array.from({ length: ARCHIVED_TASK_CAP + 1 }, (_, i) => ({
      id: `x${i}`,
      projectId: P,
      sequence: i + 1,
      title: `Old ${i}`,
      assigneeId: null,
      sprintId: s2.id,
      status: 'done',
      priority: 'normal',
      startDate: null,
      dueDate: null,
      estimate: null,
      createdAt: 0,
      dependsOn: [],
    }))
    await db.tasks.bulkAdd(rows)
    const { ctx } = await context()
    expect(ctx.text).toContain('(archived, tasks left out to save space')
    expect(ctx.text).not.toContain('"Old 0"')
  })
})

describe('buildPrompt', () => {
  it('puts the snapshot first, then the conversation, then the request', () => {
    const p = buildPrompt('SNAP', [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo', outcomes: ['x'] }], 'Q')
    expect(p.indexOf('SNAP')).toBeLessThan(p.indexOf('User: hi'))
    expect(p).toContain('Assistant: yo\n[x]')
    expect(p.trim().endsWith('<request>\nQ\n</request>')).toBe(true)
  })
})

describe('resolveActions', () => {
  it('describes valid actions and rejects bad ones without throwing', async () => {
    await task('Login', { assigneeId: an.id })
    await task('Archived home', {}, s2)
    await db.sprints.update(s2.id, { archivedAt: 1 })
    const { data, ctx } = await context()
    const out = resolveActions(
      [
        { op: 'update_task', task: 't1', status: 'done', due: '2026-11-12', assignee: 'm2', reason: 'xong' },
        { op: 'update_task', task: 't1', status: 'todo' },
        { op: 'update_task', task: 't99', status: 'done' },
        { op: 'create_task', title: 'New', due: '2026-02-30' },
        { op: 'create_task', title: 'Into archive', sprint: 's2' },
        { op: 'move_task', task: 't1', sprint: 's1' },
        { op: 'delete_task', task: 't1' },
        { op: 'drop_table' },
      ],
      data,
      ctx.handles
    )
    expect(out[0].error).toBeUndefined()
    expect(out[0].details).toEqual(['status To do → Done', 'assignee An → Bình', 'due — → Nov 12'])
    expect(out[0].reason).toBe('xong')
    expect(out[1].error).toBe('Nothing to change')
    expect(out[2].error).toBe('Unknown task "t99"')
    expect(out[3].error).toBe('Bad due date "2026-02-30"')
    expect(out[4].error).toBe('Sprint 2 is archived')
    expect(out[5].error).toBe('Already in Sprint 1')
    expect(out[6]).toMatchObject({ verb: 'Delete', subject: '#1 "Login"' })
    expect(out[7].error).toMatch(/Unknown action/)
  })

  it('lets later actions point at a task created earlier in the list', async () => {
    await task('Design')
    const { data, ctx } = await context()
    const out = resolveActions(
      [
        { op: 'create_task', ref: 'n1', title: 'Build', estimate: 3, assignee: 'm1' },
        { op: 'set_dependencies', task: 'n1', dependsOn: ['t1'] },
      ],
      data,
      ctx.handles
    )
    expect(out.map((a) => a.error)).toEqual([undefined, undefined])
    expect(out[0].sprintId).toBe(s1.id)
    expect(out[0].details[0]).toContain('in Sprint 1 · An · 3d effort')
    expect(out[1].details).toEqual(['after #1'])
  })

  it('refuses prerequisites across sprints', async () => {
    await task('Here')
    await task('There', {}, s2)
    const { data, ctx } = await context()
    const [a] = resolveActions([{ op: 'set_dependencies', task: 't1', dependsOn: ['t2'] }], data, ctx.handles)
    expect(a.error).toBe('Prerequisites must be in the same sprint')
  })
})

describe('applyActions', () => {
  it('creates, edits, links and notes through the normal DB functions', async () => {
    const design = await task('Design', { assigneeId: an.id })
    const { data, ctx } = await context()
    const actions = resolveActions(
      [
        { op: 'create_task', ref: 'n1', title: 'Build', assignee: 'm2', priority: 'high', due: '2026-11-13' },
        { op: 'set_dependencies', task: 'n1', dependsOn: ['t1'] },
        { op: 'update_task', task: 't1', status: 'in_progress', assignee: 'm2' },
        { op: 'set_sprint_note', sprint: 's1', note: 'Ship login' },
      ],
      data,
      ctx.handles
    )
    const res = await applyActions(actions, P)
    expect(res).toEqual({ applied: 4 })
    const tasks = await db.tasks.where('sprintId').equals(s1.id).toArray()
    const build = tasks.find((t) => t.title === 'Build')!
    expect(build).toMatchObject({ assigneeId: binh.id, priority: 'high', dueDate: '2026-11-13', sequence: 2 })
    expect(build.dependsOn).toEqual([design.id])
    expect(await db.tasks.get(design.id)).toMatchObject({ status: 'in_progress', assigneeId: binh.id })
    expect((await db.sprints.get(s1.id))!.note).toBe('Ship login')
    expect(summarizeActions(actions)).toBe('1 created, 1 prerequisites set, 1 edited, 1 sprint goal set')
    // The activity log saw it like a manual edit.
    const kinds = (await db.events.where('sprintId').equals(s1.id).toArray()).map((e) => e.kind)
    expect(kinds).toContain('created')
    expect(kinds).toContain('edit')
  })

  it('stops at a task that vanished since Claude answered, keeping earlier work', async () => {
    const gone = await task('Gone')
    await task('Stays')
    const { data, ctx } = await context()
    const actions = resolveActions(
      [
        { op: 'update_task', task: 't2', priority: 'urgent' },
        { op: 'update_task', task: 't1', priority: 'urgent' },
      ],
      data,
      ctx.handles
    )
    await db.tasks.delete(gone.id)
    const res = await applyActions(actions, P)
    expect(res.applied).toBe(1)
    expect(res.error).toMatch(/no longer exists/)
  })
})

describe('moveTasksToSprint', () => {
  it('renumbers into the target, brings subtasks, and cuts cross-sprint links', async () => {
    const head = await task('Group')
    const kid = await task('Child', { parentId: head.id })
    const left = await task('Left behind', { dependsOn: [kid.id] })
    await task('Already there', {}, s2)
    const moved = await moveTasksToSprint([head.id], s2.id)
    expect(moved).toBe(1) // the child; the group head tags along uncounted
    const h = (await db.tasks.get(head.id))!
    const k = (await db.tasks.get(kid.id))!
    expect([h.sprintId, k.sprintId]).toEqual([s2.id, s2.id])
    expect([h.sequence, k.sequence]).toEqual([2, 3])
    expect(k.parentId).toBe(head.id)
    expect((await db.tasks.get(left.id))!.dependsOn).toEqual([])
    const ev = await db.events.where('sprintId').equals(s2.id).filter((e) => e.kind === 'rolled_over').toArray()
    expect(ev.map((e) => e.taskTitle)).toEqual(['Child'])
  })

  it('takes a subtask out of its group when it moves alone', async () => {
    const head = await task('Group')
    const kid = await task('Child', { parentId: head.id })
    await moveTasksToSprint([kid.id], s2.id)
    expect((await db.tasks.get(kid.id))!).toMatchObject({ sprintId: s2.id, parentId: null })
    expect((await db.tasks.get(head.id))!.sprintId).toBe(s1.id)
  })
})

describe('project plan snapshot (Undo)', () => {
  it('restores tasks, sprints and activity exactly, and tells when things changed', async () => {
    const a = await task('Keep me')
    const before = await snapshotProjectPlan(P)
    const sigBefore = await projectPlanSignature(P)
    await updateTask(a.id, { title: 'Renamed' })
    await task('Extra')
    await db.sprints.update(s1.id, { note: 'changed' })
    expect(await projectPlanSignature(P)).not.toBe(sigBefore)
    await restoreProjectPlan(before)
    expect(await projectPlanSignature(P)).toBe(sigBefore)
    expect((await db.tasks.get(a.id))!.title).toBe('Keep me')
    expect(await db.events.where('projectId').equals(P).count()).toBe(before.events.length)
  })
})

describe('deck', () => {
  it('drops junk and keeps what the template can show', () => {
    expect(sanitizeDeck(null)).toBeNull()
    expect(sanitizeDeck({ title: 'x', slides: [] })).toBeNull()
    const deck = sanitizeDeck({
      title: ' Review ',
      slides: [
        { layout: 'title', title: 'Sprint 1', subtitle: 'Nov 2 → Nov 15' },
        { layout: 'nope', title: 'Fallback', bullets: ['a', 42, ''] },
        { layout: 'progress', title: 'By person', bars: [{ label: 'An', done: 3, total: 4 }, { done: 1 }] },
        { layout: 'table', title: 'Empty table', table: { columns: [], rows: [] } },
      ],
    })!
    expect(deck.title).toBe('Review')
    expect(deck.slides.map((s) => s.layout)).toEqual(['title', 'bullets', 'progress', 'table'])
    expect(deck.slides[1].bullets).toEqual(['a'])
    expect(deck.slides[2].bars).toHaveLength(1)
  })

  it('escapes every string from Claude, then allows **bold**', () => {
    const deck = sanitizeDeck({
      title: '<script>alert(1)</script>',
      slides: [{ layout: 'bullets', title: 'A & B', bullets: ['**Done** <img src=x onerror=alert(1)>'] }],
    })!
    const html = renderDeckHtml(deck)
    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toContain('<img')
    expect(html).toContain('<strong>Done</strong> &lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('1 / 1')
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;')
  })

  it('shrinks only slides too dense to clear the footer', () => {
    const long = 'Hoàn thiện màn hình nạp tiền với đầy đủ trạng thái lỗi, retry và thông báo đẩy'
    expect(slideZoom({ layout: 'bullets', title: 'Light', bullets: ['a', 'b'] })).toBe(1)
    const dense = slideZoom({ layout: 'bullets', title: 'Dense', subtitle: long, bullets: Array(6).fill(long + long) })
    expect(dense).toBeLessThan(1)
    expect(dense).toBeGreaterThanOrEqual(0.5)
    expect(slideZoom({ layout: 'title', title: long, bullets: Array(10).fill(long) })).toBe(1)
    const html = renderDeckHtml(sanitizeDeck({ title: 'D', slides: [{ layout: 'bullets', title: 'x', bullets: Array(10).fill(long) }] })!)
    expect(html).toMatch(/class="body" style="zoom:0\.\d+"/)
  })

  it('leaves the script and present bar out of the preview', () => {
    const deck = sanitizeDeck({ title: 'D', slides: [{ layout: 'bullets', title: 'x', bullets: ['a'] }] })!
    expect(renderDeckHtml(deck)).toContain('<script>')
    expect(renderDeckHtml(deck, { script: false })).not.toMatch(/<script>|id="present"/)
  })

  it('makes a safe file name', () => {
    expect(deckFileName('Sprint 12: review / Q4')).toBe('Sprint 12 review Q4.html')
    expect(deckFileName('..hidden...')).toBe('hidden.html')
    expect(deckFileName('   ')).toBe('plan-up deck.html')
  })
})
