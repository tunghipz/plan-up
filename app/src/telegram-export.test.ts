import { describe, expect, it } from 'vitest'
import { formatSprintTree, membersWithTasks } from './telegram-export'
import type { Member, Sprint, Task } from './types'

function member(id: string, name: string, order?: number): Member {
  return { id, projectId: 'p', name, color: '#0071e3', daysOff: [], order }
}

function task(id: string, assigneeId: string | null, seq: number, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p',
    sequence: seq,
    title: `Task ${seq}`,
    assigneeId,
    sprintId: 's',
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: seq,
    dependsOn: [],
    ...over,
  }
}

const sprint: Sprint = {
  id: 's',
  projectId: 'p',
  name: 'Sprint 12',
  startDate: '2026-07-08',
  endDate: '2026-07-19',
}

describe('formatSprintTree', () => {
  it('opens with a 📋 header line carrying the name + date range', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [task('t1', 'a', 1)])
    expect(out.split('\n')[0]).toBe('📋 Sprint 12  ·  Jul 8 → Jul 19')
  })

  it('renders status as WORDS and appends due only when present', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 12, { title: 'Payment', status: 'in_progress', dueDate: '2026-07-15' }),
      task('t2', 'a', 14, { title: 'Refund', status: 'todo' }),
    ])
    expect(out).toContain('#12 Payment — Đang làm · Jul 15')
    expect(out).toContain('#14 Refund — Chưa làm')
    // no due → no trailing " · <date>"
    expect(out).not.toMatch(/#14 Refund — Chưa làm ·/)
  })

  it('never emits priority', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1, { priority: 'urgent' }),
    ])
    expect(out).not.toMatch(/Urgent|Gấp|urgent|priority/i)
  })

  it('uses ├─ for non-last members/tasks and └─ for the last', () => {
    const members = [member('a', 'An', 0), member('b', 'Bình', 1)]
    const out = formatSprintTree(sprint, members, [task('t1', 'a', 1), task('t2', 'b', 2)])
    const lines = out.split('\n')
    expect(lines).toContain('├─ 👤 An')
    expect(lines).toContain('└─ 👤 Bình')
  })

  it('nests a child under its parent within the lane (no #seq, status only)', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('p1', 'a', 12, { title: 'Payment' }),
      task('c1', 'a', 13, { title: 'Webhooks', parentId: 'p1', status: 'done' }),
    ])
    const lines = out.split('\n')
    const parent = lines.findIndex((l) => l.includes('#12 Payment'))
    const child = lines.findIndex((l) => l.includes('Webhooks'))
    expect(parent).toBeGreaterThan(-1)
    expect(child).toBe(parent + 1)
    expect(lines[child]).toContain('Webhooks — Xong')
    expect(lines[child]).not.toContain('#13') // children drop the seq
  })

  it('labels the unassigned bucket "Chưa gán" and sorts it last', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [
      task('t1', 'a', 1),
      task('t2', null, 2),
    ])
    const lines = out.split('\n')
    expect(lines).toContain('├─ 👤 An')
    expect(lines).toContain('└─ 👤 Chưa gán')
    expect(lines.indexOf('└─ 👤 Chưa gán')).toBeGreaterThan(lines.indexOf('├─ 👤 An'))
  })

  it('scopes to a single member when memberId is given', () => {
    const members = [member('a', 'An', 0), member('b', 'Bình', 1)]
    const tasks = [task('t1', 'a', 1), task('t2', 'b', 2)]
    const out = formatSprintTree(sprint, members, tasks, { memberId: 'a' })
    expect(out).toContain('👤 An')
    expect(out).not.toContain('Bình')
    // the sole member becomes the last branch
    expect(out).toContain('└─ 👤 An')
  })

  it('emits just the header when the sprint has no tasks', () => {
    const out = formatSprintTree(sprint, [member('a', 'An', 0)], [])
    expect(out).toBe('📋 Sprint 12  ·  Jul 8 → Jul 19')
  })
})

describe('membersWithTasks', () => {
  it('returns only real members that own tasks, in lane order, excluding unassigned', () => {
    const members = [member('b', 'Bình', 1), member('a', 'An', 0), member('c', 'Chi', 2)]
    const tasks = [task('t1', 'b', 1), task('t2', 'a', 2), task('t3', null, 3)]
    expect(membersWithTasks(members, tasks).map((m) => m.name)).toEqual(['An', 'Bình'])
  })
})
