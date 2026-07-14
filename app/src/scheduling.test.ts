import { describe, expect, it } from 'vitest'
import { computeStartEnd } from './scheduling'
import type { Task } from './types'

// Scheduling: a MILESTONE (effort 0) prereq must anchor its dependents on the
// milestone DATE (stored in `startDate`), not its `dueDate` (which is null or a
// stale leftover). Regression from the 2026-07-14 bug where a task depending on a
// milestone chained off the milestone's stale dueDate instead of its date.
// See design-docs/scheduling.md + milestones.md.

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p',
    sequence: 1,
    title: id,
    assigneeId: null, // no member → every weekday is a full working day
    sprintId: 's',
    status: 'todo',
    priority: 'normal',
    startDate: null,
    dueDate: null,
    estimate: null,
    createdAt: 1,
    dependsOn: [],
    ...over,
  }
}

const byId = (...tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]))

describe('milestone prereq chaining', () => {
  it('anchors a dependent on the milestone DATE (startDate), ignoring a stale dueDate', () => {
    // Milestone on Tue Jul 14; a STALE early dueDate lingers from before it was a milestone.
    const m = task('m', { estimate: 0, startDate: '2026-07-14', dueDate: '2026-06-30' })
    const s = task('s', { estimate: 5, dependsOn: ['m'] })
    const plan = computeStartEnd(s, byId(m, s))
    // Follows Jul 14 → next working day Jul 15, +5 working days (skip Sat/Sun 18-19) → Jul 21.
    expect(plan.startDate).toBe('2026-07-15')
    expect(plan.dueDate).toBe('2026-07-21')
  })

  it('chains off a proper milestone whose dueDate is null', () => {
    const m = task('mp', { estimate: 0, startDate: '2026-07-14', dueDate: null })
    const s = task('sp', { estimate: 1, dependsOn: ['mp'] })
    const plan = computeStartEnd(s, byId(m, s))
    expect(plan.startDate).toBe('2026-07-15')
    expect(plan.dueDate).toBe('2026-07-15')
  })

  it('clears the start when the milestone prereq has no date at all', () => {
    const m = task('m0', { estimate: 0, startDate: null, dueDate: null })
    const s = task('s0', { estimate: 3, dependsOn: ['m0'] })
    const plan = computeStartEnd(s, byId(m, s))
    expect(plan.startDate).toBeNull()
  })

  it('regression: a NORMAL (effort) prereq still anchors on its computed dueDate', () => {
    // Normal task Mon Jul 6, effort 2 → ends Jul 7. Dependent must start Jul 8
    // (day after the END), NOT Jul 7 (day after its start) — proving normal
    // prereqs keep using dueDate.
    const n = task('n', { estimate: 2, startDate: '2026-07-06' })
    const s = task('s2', { estimate: 1, dependsOn: ['n'] })
    const plan = computeStartEnd(s, byId(n, s))
    expect(plan.startDate).toBe('2026-07-08')
  })
})
