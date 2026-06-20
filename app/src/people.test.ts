import { describe, it, expect } from 'vitest'
import {
  normalizePersonName,
  buildPersonBackfill,
  personLoad,
  personProjectCount,
  nextDayOff,
  taskOverdue,
} from './people'
import type { Member, Task } from './db'

// Cross-project People identity helpers. See design-docs/home-dashboard.md.
// These are pure functions — the v13 migration and HomeDashboard call them.

const mkMember = (over: Partial<Member> & Pick<Member, 'id' | 'projectId' | 'name'>): Member => ({
  color: '#000',
  daysOff: [],
  ...over,
})

const mkTask = (over: Partial<Task> & Pick<Task, 'id' | 'assigneeId'>): Task => ({
  projectId: 'p',
  sequence: 1,
  title: 't',
  sprintId: 's',
  status: 'todo',
  priority: 'normal',
  startDate: null,
  dueDate: null,
  estimate: null,
  createdAt: 0,
  dependsOn: [],
  ...over,
})

describe('normalizePersonName', () => {
  it('trims and lowercases so name variants unify', () => {
    expect(normalizePersonName('  Tùng ')).toBe('tùng')
    expect(normalizePersonName('TÙNG')).toBe('tùng')
  })
})

describe('buildPersonBackfill', () => {
  it('groups members by normalized name across projects into one person each', () => {
    let n = 0
    const id = () => `person-${++n}`
    const members = [
      mkMember({ id: 'm1', projectId: 'pA', name: 'Tùng', color: '#aaa' }),
      mkMember({ id: 'm2', projectId: 'pB', name: 'tùng ', color: '#bbb' }),
      mkMember({ id: 'm3', projectId: 'pA', name: 'Linh', color: '#ccc' }),
    ]
    const { people, links } = buildPersonBackfill(members, id, () => '#zzz', 1000)

    // m1 + m2 collapse to one person; m3 is its own
    expect(people).toHaveLength(2)
    // first member of a group seeds the person's display name + color
    expect(people[0]).toEqual({ id: 'person-1', name: 'Tùng', color: '#aaa', createdAt: 1000 })
    expect(people[1]).toEqual({ id: 'person-2', name: 'Linh', color: '#ccc', createdAt: 1000 })
    expect(links).toEqual([
      { memberId: 'm1', personId: 'person-1' },
      { memberId: 'm2', personId: 'person-1' },
      { memberId: 'm3', personId: 'person-2' },
    ])
  })

  it('falls back to colorFor(name) when a member has no color', () => {
    const members = [mkMember({ id: 'm1', projectId: 'p', name: 'Sam', color: '' })]
    const { people } = buildPersonBackfill(members, () => 'pid', () => '#fallback', 5)
    expect(people[0].color).toBe('#fallback')
  })
})

describe('personLoad', () => {
  it('sums non-done LEAF tasks assigned to the person, treating null estimate as 0', () => {
    const memberIds = new Set(['m1', 'm2'])
    const tasks: Task[] = [
      mkTask({ id: 't1', assigneeId: 'm1' }), // parent of t2 → excluded
      mkTask({ id: 't2', assigneeId: 'm1', parentId: 't1', estimate: 3 }), // leaf, counts
      mkTask({ id: 't3', assigneeId: 'm1', estimate: 2, status: 'done' }), // done → excluded
      mkTask({ id: 't4', assigneeId: 'm2', estimate: null }), // leaf, effort 0
      mkTask({ id: 't5', assigneeId: 'mX', estimate: 5 }), // not this person
    ]
    expect(personLoad(memberIds, tasks)).toEqual({ taskCount: 2, effort: 3 })
  })

  it('is zero when the person has no assigned open tasks', () => {
    expect(personLoad(new Set(['m9']), [mkTask({ id: 't1', assigneeId: 'm1' })])).toEqual({
      taskCount: 0,
      effort: 0,
    })
  })
})

describe('personProjectCount', () => {
  it('counts distinct projects the person appears in', () => {
    const members = [
      mkMember({ id: 'm1', projectId: 'pA', name: 'T' }),
      mkMember({ id: 'm2', projectId: 'pB', name: 'T' }),
      mkMember({ id: 'm3', projectId: 'pA', name: 'T' }),
    ]
    expect(personProjectCount(members)).toBe(2)
  })
})

describe('taskOverdue', () => {
  const today = '2026-06-20'
  it('flags a normal task past its dueDate and not done', () => {
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', dueDate: '2026-06-10' }), today)).toBe(true)
  })
  it('does not flag a future or absent due date', () => {
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', dueDate: '2026-06-30' }), today)).toBe(false)
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', dueDate: null }), today)).toBe(false)
  })
  it('never flags a done task', () => {
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', dueDate: '2026-06-10', status: 'done' }), today)).toBe(false)
  })
  it('uses startDate (not dueDate) for a milestone (estimate === 0)', () => {
    // milestone date lives on startDate; dueDate is irrelevant
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', estimate: 0, startDate: '2026-06-10', dueDate: null }), today)).toBe(true)
    expect(taskOverdue(mkTask({ id: 't', assigneeId: 'm', estimate: 0, startDate: '2026-06-30', dueDate: null }), today)).toBe(false)
  })
})

describe('nextDayOff', () => {
  const members = [
    mkMember({ id: 'm1', projectId: 'pA', name: 'T', daysOff: [{ date: '2026-06-10' }, { date: '2026-06-24' }] }),
    mkMember({ id: 'm2', projectId: 'pB', name: 'T', daysOff: [{ date: '2026-06-24' }, { date: '2026-07-01' }] }),
  ]
  it('returns the soonest upcoming off-day, unioned + deduped across projects', () => {
    expect(nextDayOff(members, '2026-06-20')).toBe('2026-06-24')
  })
  it('returns null when there are no upcoming off-days', () => {
    expect(nextDayOff(members, '2026-08-01')).toBeNull()
  })
})
