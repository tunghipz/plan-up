import { describe, it, expect } from 'vitest'
import { buildDateSortKeys, compareTasks } from './SprintView'
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
