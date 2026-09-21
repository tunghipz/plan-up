import { describe, expect, it } from 'vitest'
import { computeStartEnd, computeWorkingPlan } from './scheduling'
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
  it('anchors a dependent on the milestone DATE at the milestone time (same day), ignoring a stale dueDate', () => {
    // Milestone on Tue Jul 14 at 08:00 (startOffset 0); a STALE early dueDate lingers.
    const m = task('m', { estimate: 0, startDate: '2026-07-14', dueDate: '2026-06-30' })
    const s = task('s', { estimate: 5, dependsOn: ['m'] })
    const plan = computeStartEnd(s, byId(m, s))
    // 08:00 milestone → dependent starts the SAME day (Jul 14), +5 working days
    // (skip Sat/Sun 18-19) → Jul 20. (Was Jul 15/21 when a milestone was wrongly
    // treated as finishing at end-of-day.)
    expect(plan.startDate).toBe('2026-07-14')
    expect(plan.dueDate).toBe('2026-07-20')
  })

  it('chains off a proper milestone whose dueDate is null — same day at 08:00', () => {
    const m = task('mp', { estimate: 0, startDate: '2026-07-14', dueDate: null })
    const s = task('sp', { estimate: 1, dependsOn: ['mp'] })
    const plan = computeStartEnd(s, byId(m, s))
    expect(plan.startDate).toBe('2026-07-14')
    expect(plan.dueDate).toBe('2026-07-14')
  })

  it('clears the start when the milestone prereq has no date at all', () => {
    const m = task('m0', { estimate: 0, startDate: null, dueDate: null })
    const s = task('s0', { estimate: 3, dependsOn: ['m0'] })
    const plan = computeStartEnd(s, byId(m, s))
    expect(plan.startDate).toBeNull()
  })

  it('a MILESTONE dependent sits on the prereq finish day, never pushed past a weekend', () => {
    // Prereq effort 3 from Wed Jul 8 → ends Fri Jul 10 (17:00). A milestone
    // depending on it is zero-duration, so it marks Jul 10 itself — NOT the next
    // working day Mon Jul 13 (which is what a task needing capacity would get).
    const n = task('nn', { estimate: 3, startDate: '2026-07-08' })
    const ms = task('ms', { estimate: 0, dependsOn: ['nn'] })
    const plan = computeStartEnd(ms, byId(n, ms))
    expect(plan.startDate).toBe('2026-07-10')
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

describe('milestone display time (computeWorkingPlan)', () => {
  // A milestone is an INSTANT: its wall time is where it sits (startOffset), not
  // the hardcoded end-of-day dueFraction. start & end read the same time. This
  // pins the 2026-07-15 fix — before it, every milestone showed a bogus 17:00.

  it('shows 17:00 when the prereq finishes end-of-day (17:00)', () => {
    // Prereq effort 1 Mon Jul 6 → ends Jul 6 at 17:00 (dueFraction 1).
    const n = task('n17', { estimate: 1, startDate: '2026-07-06' })
    const ms = task('m17', { estimate: 0, dependsOn: ['n17'] })
    const plan = computeWorkingPlan(ms, byId(n, ms))
    expect(plan.startDate).toBe('2026-07-06')
    expect(plan.endTime).toBe('17:00')
    expect(plan.startTime).toBe('17:00') // instant → start === end
  })

  it('shows 12:00 (noon) when the prereq finishes at midday — NOT a bogus 17:00', () => {
    // Prereq effort 0.5 Mon Jul 6 → ends Jul 6 at noon (dueFraction 0.5). The
    // milestone marks that instant → 12:00. (Pre-fix this wrongly read 17:00.)
    const n = task('nHalf', { estimate: 0.5, startDate: '2026-07-06' })
    const ms = task('mNoon', { estimate: 0, dependsOn: ['nHalf'] })
    const plan = computeWorkingPlan(ms, byId(n, ms))
    expect(plan.startDate).toBe('2026-07-06')
    expect(plan.endTime).toBe('12:00')
    expect(plan.startTime).toBe('12:00')
  })

  it('shows 08:00 for a manual milestone with no prereq (day-start instant)', () => {
    // No prereqs → startOffset 0 → 08:00, consistent with how an 08:00 milestone
    // anchors its own dependents at day-start.
    const ms = task('mMan', { estimate: 0, startDate: '2026-07-14' })
    const plan = computeWorkingPlan(ms, byId(ms))
    expect(plan.startDate).toBe('2026-07-14')
    expect(plan.endTime).toBe('08:00')
    expect(plan.startTime).toBe('08:00')
  })
})

// The engine must only rewrite dates it OWNS. `recomputeAllDates()` persists
// whatever `planFor` returns on every app load, so a "normalization" applied to
// a hand-typed date overwrites the user's own value with no undo. Regression
// from the 2026-09-21 bug: a collection event set to Sat Sep 5 → Sep 7 came back
// as Mon Sep 7 → Sep 7 after nothing but opening the app.
// See design-docs/scheduling.md "Rules & edge cases".
describe('manual dates the engine does not own', () => {
  it('keeps a manual weekend start when there is no effort and no prereq', () => {
    // Sat 2026-09-05 → Mon 2026-09-07, exactly as typed in the range picker.
    const t = task('ev', { startDate: '2026-09-05', dueDate: '2026-09-07' })
    expect(computeStartEnd(t, byId(t))).toEqual({
      startDate: '2026-09-05',
      dueDate: '2026-09-07',
    })
  })

  it('keeps a manual Sunday start too (the other half of the weekend)', () => {
    const t = task('ev2', { startDate: '2026-09-20', dueDate: '2026-09-22' })
    expect(computeStartEnd(t, byId(t))).toEqual({
      startDate: '2026-09-20',
      dueDate: '2026-09-22',
    })
  })

  it('leaves a manual off-day start alone as well, not just weekends', () => {
    const m = { id: 'mm', name: 'mm', daysOff: [{ date: '2026-09-08' }] }
    const t = task('ev3', { assigneeId: 'mm', startDate: '2026-09-08', dueDate: '2026-09-10' })
    const plan = computeStartEnd(t, byId(t), new Map([['mm', m as never]]))
    expect(plan.startDate).toBe('2026-09-08')
  })

  it('STILL normalizes a weekend start once the task has effort (engine owns it)', () => {
    // Sat 2026-09-05 + 2 days effort → Mon Sep 7, Tue Sep 8.
    const t = task('w', { startDate: '2026-09-05', estimate: 2 })
    expect(computeStartEnd(t, byId(t))).toEqual({
      startDate: '2026-09-07',
      dueDate: '2026-09-08',
    })
  })

  it('STILL normalizes a prereq-derived start off a weekend', () => {
    // Prereq ends Fri Sep 4 at 17:00 → dependent starts Mon Sep 7, not Sat.
    const p = task('pw', { estimate: 1, startDate: '2026-09-04' })
    const d = task('dw', { estimate: 1, dependsOn: ['pw'] })
    expect(computeStartEnd(d, byId(p, d)).startDate).toBe('2026-09-07')
  })
})

// A collection item is a dated row, not work: no assignee/effort/prereq columns
// exist for it, and weekends/holidays are working-time concepts that must not
// touch it. See design-docs/collections.md "Cách ly khỏi sprint engine".
describe('collection items are outside the engine', () => {
  it('returns a collection item’s stored dates verbatim, weekend or not', () => {
    const t = task('c1', {
      sprintId: null,
      collectionId: 'coll',
      startDate: '2026-09-05', // Saturday
      dueDate: '2026-09-07',
    })
    expect(computeStartEnd(t, byId(t))).toEqual({
      startDate: '2026-09-05',
      dueDate: '2026-09-07',
    })
  })

  it('ignores effort and prereqs on a collection item (stale data from an import)', () => {
    const p = task('cp', { estimate: 1, startDate: '2026-09-04' })
    const t = task('c2', {
      sprintId: null,
      collectionId: 'coll',
      estimate: 3,
      dependsOn: ['cp'],
      startDate: '2026-09-05',
      dueDate: '2026-09-07',
    })
    expect(computeStartEnd(t, byId(p, t))).toEqual({
      startDate: '2026-09-05',
      dueDate: '2026-09-07',
    })
  })

  it('ignores a project holiday covering a collection item', () => {
    const t = task('c3', {
      sprintId: null,
      collectionId: 'coll',
      startDate: '2026-09-08',
      dueDate: '2026-09-09',
    })
    const hol = new Map([['p', [{ date: '2026-09-08' }, { date: '2026-09-09' }]]])
    expect(computeStartEnd(t, byId(t), undefined, hol)).toEqual({
      startDate: '2026-09-08',
      dueDate: '2026-09-09',
    })
  })
})
