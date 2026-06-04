import { describe, it, expect } from 'vitest'
import { computeMemberConflicts } from './SprintView'
import type { Member, Task } from './db'

const P = 'proj'
const M = 'm1'
const member: Member = { id: M, projectId: P, name: 'X', color: '#000', daysOff: [] }
const members = new Map([[M, member]])

function mk(id: string, seq: number, startDate: string, estimate: number, deps: string[] = []): Task {
  return {
    id,
    projectId: P,
    sequence: seq,
    title: id,
    assigneeId: M,
    sprintId: 's',
    status: 'todo',
    priority: 'normal',
    startDate,
    dueDate: null,
    estimate,
    createdAt: 0,
    dependsOn: deps,
  }
}

describe('computeMemberConflicts — time-range overlap', () => {
  it('flags two tasks whose computed intervals overlap (the reported case)', () => {
    // #20: Jun 8 08:00 → Jun 11 17:00 (4 working days Mon–Thu)
    // #1:  Jun 11 08:00 → Jun 17 17:00 (5 working days, skips the weekend)
    // They both run on Jun 11 → conflict.
    const a = mk('a', 20, '2026-06-08', 4)
    const b = mk('b', 1, '2026-06-11', 5)
    const byId = new Map([[a.id, a], [b.id, b]])
    const tips = computeMemberConflicts([a, b], byId, members)
    expect(tips.get('a')).toBeDefined()
    expect(tips.get('b')).toBeDefined()
    expect(tips.get('a')).toContain('chồng thời gian')
    expect(tips.get('a')).toContain('#1') // names the other task by sequence
    expect(tips.get('b')).toContain('#20')
  })

  it('does NOT flag back-to-back tasks (touching endpoints, no overlap)', () => {
    // #1: Jun 8 → Jun 9 17:00 ; #2: Jun 10 08:00 → Jun 11 17:00 — no intersection
    const a = mk('a', 1, '2026-06-08', 2)
    const b = mk('b', 2, '2026-06-10', 2)
    const byId = new Map([[a.id, a], [b.id, b]])
    const tips = computeMemberConflicts([a, b], byId, members)
    expect(tips.size).toBe(0)
  })

  it('still flags a shared prerequisite independently of time', () => {
    const p = mk('p', 9, '2026-06-01', 1)
    // two dependents of p, scheduled after p — they share a prereq
    const a = mk('a', 1, '2026-06-02', 1, ['p'])
    const b = mk('b', 2, '2026-06-02', 1, ['p'])
    const byId = new Map([[p.id, p], [a.id, a], [b.id, b]])
    const tips = computeMemberConflicts([p, a, b], byId, members)
    expect(tips.get('a')).toContain('chung prereq')
  })

  it('excludes unsized tasks (estimate === null)', () => {
    const a: Task = { ...mk('a', 1, '2026-06-08', 4), estimate: null }
    const b = mk('b', 2, '2026-06-08', 4)
    const byId = new Map([[a.id, a], [b.id, b]])
    const tips = computeMemberConflicts([a, b], byId, members)
    expect(tips.size).toBe(0)
  })
})
