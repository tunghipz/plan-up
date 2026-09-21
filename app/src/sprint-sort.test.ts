import { describe, it, expect } from 'vitest'
import { buildDateSortKeys, compareTasks } from './SprintView'
import { orderLane, pullDependentsUnderPrereqs } from './task-sort'
import type { Task } from './types'
import type { WorkingPlan } from './scheduling'

// Minimal task/plan builders — the sort only reads id/parentId/sequence/dueDate.
const mkTask = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, parentId: null, sequence: 0, dueDate: null, startDate: null, ...extra }) as Task

const plan = (dueDate: string | null, startDate: string | null = null): WorkingPlan => ({
  startDate,
  dueDate,
  startTime: '08:00',
  endTime: '17:00',
})

describe('Start/End sort uses the displayed computed/rollup date', () => {
  // Reproduces the reported bug: a parent ("build 3") whose End cell rolls up to
  // Jul 20 (max child end) was sorting AFTER leaves ending Jul 21 / Jul 22, because
  // its own raw dueDate is empty and collapsed to the sort-last sentinel.
  const parent = mkTask('build3', { sequence: 5 }) // raw dueDate null
  const kid1 = mkTask('k1', { parentId: 'build3', sequence: 6 })
  const kid2 = mkTask('k2', { parentId: 'build3', sequence: 7 })
  const fixBug = mkTask('fix', { sequence: 15, dueDate: '2026-07-21' })
  const polish = mkTask('polish', { sequence: 8, dueDate: '2026-07-22' })

  const lane = [parent, kid1, kid2, fixBug, polish]
  const planById = new Map<string, WorkingPlan>([
    ['k1', plan('2026-07-18')],
    ['k2', plan('2026-07-20')], // latest child end → parent rollup = Jul 20
    ['fix', plan('2026-07-21')],
    ['polish', plan('2026-07-22')],
  ])

  it('rolls a parent up to its latest child end', () => {
    const keys = buildDateSortKeys(lane, planById)
    expect(keys.get('build3')?.dueDate).toBe('2026-07-20T17:00')
  })

  it('sorts the parent by its rollup, before later leaves', () => {
    const keys = buildDateSortKeys(lane, planById)
    const sorted = [...lane].sort((a, b) => compareTasks(a, b, 'dueDate', 'asc', keys))
    // Top-level order (ignoring children) must be Jul20 parent → Jul21 → Jul22.
    const topLevel = sorted.filter((t) => !t.parentId).map((t) => t.id)
    expect(topLevel).toEqual(['build3', 'fix', 'polish'])
  })

  it('without the rollup keys, the parent wrongly sorts last (documents the bug)', () => {
    const sorted = [...lane].sort((a, b) => compareTasks(a, b, 'dueDate', 'asc'))
    const topLevel = sorted.filter((t) => !t.parentId).map((t) => t.id)
    expect(topLevel).toEqual(['fix', 'polish', 'build3'])
  })
})

// ── dependents pulled under their prerequisite, in every sort ─────────────
// The stored `listOrder` move only fixes the MANUAL order; with a sort column
// on, an unscheduled dependent (empty End) drifts back to the bottom of the
// lane — the exact stranding the move exists to prevent. `orderLane` re-applies
// the pairing after sorting. See design-docs/dependencies.md.
describe('pullDependentsUnderPrereqs', () => {
  const t = (id: string, extra: Partial<Task> = {}): Task =>
    mkTask(id, { dependsOn: [], ...extra })
  const ids = (list: Task[]) => list.map((x) => x.id)

  it('lifts a dependent from the bottom to directly under its prereq', () => {
    // The reported case: #6 depends on #1 but sorts last on an empty End.
    const lane = [t('a'), t('b'), t('c'), t('dep', { dependsOn: ['a'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['a', 'dep', 'b', 'c'])
  })

  it('anchors on the LOWEST prereq so the row sits below all of them', () => {
    const lane = [t('a'), t('b'), t('c'), t('dep', { dependsOn: ['a', 'b'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['a', 'b', 'dep', 'c'])
  })

  it('keeps a chain contiguous and in chain order', () => {
    const lane = [t('a'), t('x'), t('c', { dependsOn: ['b'] }), t('b', { dependsOn: ['a'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['a', 'b', 'c', 'x'])
  })

  it('keeps several dependents of one prereq in the sorted order among themselves', () => {
    const lane = [t('a'), t('d1', { dependsOn: ['a'] }), t('z'), t('d2', { dependsOn: ['a'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['a', 'd1', 'd2', 'z'])
  })

  it('ignores a prereq that is not in this lane', () => {
    const lane = [t('a'), t('b'), t('dep', { dependsOn: ['elsewhere'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['a', 'b', 'dep'])
  })

  it('ignores a prereq in another group scope — never re-parents a row', () => {
    // `dep` is a top-level row; its prereq is a child of a group. Pulling it
    // under that child would read as "dep joined the group".
    const lane = [t('g'), t('kid', { parentId: 'g' }), t('dep', { dependsOn: ['kid'] })]
    expect(ids(pullDependentsUnderPrereqs(lane))).toEqual(['g', 'kid', 'dep'])
    // Same scope (both children of g) → pulled.
    const sameScope = [
      t('g'),
      t('k1', { parentId: 'g' }),
      t('k3', { parentId: 'g' }),
      t('k2', { parentId: 'g', dependsOn: ['k1'] }),
    ]
    expect(ids(pullDependentsUnderPrereqs(sameScope))).toEqual(['g', 'k1', 'k2', 'k3'])
  })

  it('leaves a lane with no prereqs completely untouched (same array)', () => {
    const lane = [t('a'), t('b')]
    expect(pullDependentsUnderPrereqs(lane)).toBe(lane)
  })

  it('drops no row when imported data contains a dependency loop', () => {
    const lane = [t('a', { dependsOn: ['b'] }), t('b', { dependsOn: ['a'] }), t('c')]
    expect(ids(pullDependentsUnderPrereqs(lane)).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('orderLane — sort then pull', () => {
  const t = (id: string, extra: Partial<Task> = {}): Task =>
    mkTask(id, { dependsOn: [], ...extra })

  it('holds the dependent under its prereq even when End sorts it last', () => {
    // End ascending: dated rows first, the empty-End dependent last… except it
    // waits on `one`, so it renders right under it.
    const one = t('one', { sequence: 1, dueDate: '2026-09-29' })
    const two = t('two', { sequence: 2, dueDate: '2026-09-30' })
    const dep = t('dep', { sequence: 6, dueDate: null, dependsOn: ['one'] })
    const plans = new Map<string, WorkingPlan>([
      ['one', plan('2026-09-29')],
      ['two', plan('2026-09-30')],
      ['dep', plan(null)],
    ])
    const out = orderLane([two, dep, one], { field: 'dueDate', dir: 'asc' }, plans)
    expect(out.map((x) => x.id)).toEqual(['one', 'dep', 'two'])
  })

  it('does the same in the neutral (manual) order', () => {
    const one = t('one', { sequence: 1 })
    const two = t('two', { sequence: 2 })
    const dep = t('dep', { sequence: 6, dependsOn: ['one'] })
    const out = orderLane([one, two, dep], { field: null, dir: 'asc' }, new Map())
    expect(out.map((x) => x.id)).toEqual(['one', 'dep', 'two'])
  })
})
