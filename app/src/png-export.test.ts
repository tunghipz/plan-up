import { describe, expect, it } from 'vitest'
import { groupTasksByMember, pngFilename, slugify } from './png-export'
import type { Member, Task } from './types'

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

describe('groupTasksByMember', () => {
  it('groups by assignee, ordered by Member.order', () => {
    const members = [member('b', 'Bob', 1), member('a', 'Alice', 0)]
    const tasks = [task('t1', 'b', 1), task('t2', 'a', 2)]
    const groups = groupTasksByMember(tasks, members)
    expect(groups.map((g) => g.member?.name)).toEqual(['Alice', 'Bob'])
  })

  it('drops members with no tasks', () => {
    const members = [member('a', 'Alice', 0), member('b', 'Bob', 1)]
    const tasks = [task('t1', 'a', 1)]
    const groups = groupTasksByMember(tasks, members)
    expect(groups).toHaveLength(1)
    expect(groups[0].member?.name).toBe('Alice')
  })

  it('puts the Unassigned bucket last', () => {
    const members = [member('a', 'Alice', 0)]
    const tasks = [task('t1', null, 1), task('t2', 'a', 2)]
    const groups = groupTasksByMember(tasks, members)
    expect(groups.map((g) => g.member?.name ?? 'Unassigned')).toEqual(['Alice', 'Unassigned'])
  })

  it('omits Unassigned when every task has an assignee', () => {
    const members = [member('a', 'Alice', 0)]
    const groups = groupTasksByMember([task('t1', 'a', 1)], members)
    expect(groups.some((g) => g.member === null)).toBe(false)
  })

  it('sorts tasks within a group by listOrder ?? sequence', () => {
    const members = [member('a', 'Alice', 0)]
    const tasks = [
      task('t1', 'a', 3),
      task('t2', 'a', 1, { listOrder: 99 }), // dragged to the bottom
      task('t3', 'a', 2),
    ]
    const groups = groupTasksByMember(tasks, members)
    // seq 3 (no order→3), seq 2 (→2), then listOrder 99 → last
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['t3', 't1', 't2'])
  })

  it('handles empty input', () => {
    expect(groupTasksByMember([], [])).toEqual([])
  })

  it('sweeps a task with an unknown/deleted assignee into Unassigned (like the List orphan lane)', () => {
    const groups = groupTasksByMember([task('t1', 'ghost', 1)], [member('a', 'Alice', 0)])
    expect(groups).toHaveLength(1)
    expect(groups[0].member).toBeNull()
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['t1'])
  })

  it('respects the active sort field (e.g. effort asc)', () => {
    const members = [member('a', 'Alice', 0)]
    const tasks = [
      task('t1', 'a', 1, { estimate: 3 }),
      task('t2', 'a', 2, { estimate: 1 }),
      task('t3', 'a', 3, { estimate: 2 }),
    ]
    const groups = groupTasksByMember(tasks, members, { sort: { field: 'effort', dir: 'asc' } })
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('nests children under their parent when nestChildren is set', () => {
    const members = [member('a', 'Alice', 0)]
    const tasks = [
      task('p1', 'a', 1),
      task('p2', 'a', 4),
      task('c1', 'a', 2, { parentId: 'p1' }),
      task('c2', 'a', 3, { parentId: 'p1' }),
    ]
    const groups = groupTasksByMember(tasks, members, { nestChildren: true })
    // p1 then its children (seq order), then p2 — children float up under parent.
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['p1', 'c1', 'c2', 'p2'])
  })
})

describe('slugify', () => {
  it('strips Vietnamese diacritics and đ', () => {
    expect(slugify('Sprint 1 — Đội Backend')).toBe('sprint-1-doi-backend')
  })
  it('collapses separators and trims', () => {
    expect(slugify('  Hello,  World!! ')).toBe('hello-world')
  })
  it('caps length at 60', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60)
  })
})

describe('pngFilename', () => {
  it('builds plan-up-<slug>-<date>.png', () => {
    expect(pngFilename('Sprint 3', '2026-07-08')).toBe('plan-up-sprint-3-2026-07-08.png')
  })
  it('falls back to "tasks" when the slug is empty', () => {
    expect(pngFilename('———', '2026-07-08')).toBe('plan-up-tasks-2026-07-08.png')
  })
})
