import { describe, expect, it, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from './schema'
import {
  computeWorkingPlan,
  expandHolidays,
  projectHolidayMap,
  setProjectHolidays,
  recomputeDates,
  uid,
} from './db'
import { holidayLoadInSpan, holidayWorkDays } from './lib'
import type { Holiday, Member, Project, Task } from './types'

// ── pure helpers ──────────────────────────────────────────────────────────

describe('expandHolidays', () => {
  it('expands an inclusive range into one entry per date', () => {
    const days = expandHolidays([
      { id: 'a', name: 'Tết', from: '2027-02-03', to: '2027-02-11' },
    ])
    expect(days).toHaveLength(9)
    expect(days[0].date).toBe('2027-02-03')
    expect(days[8].date).toBe('2027-02-11')
    expect(days.every((d) => d.half === undefined)).toBe(true)
  })

  it('keeps `half` on a single-day range and drops it on a multi-day one', () => {
    expect(
      expandHolidays([{ id: 'a', name: 'x', from: '2026-12-25', to: '2026-12-25', half: 'pm' }])
    ).toEqual([{ date: '2026-12-25', half: 'pm' }])
    // "PM off for three days running" is meaningless — every date comes back full.
    const multi = expandHolidays([
      { id: 'b', name: 'y', from: '2026-12-25', to: '2026-12-27', half: 'pm' },
    ])
    expect(multi.every((d) => d.half === undefined)).toBe(true)
  })

  it('ignores a backwards or malformed range instead of looping forever', () => {
    expect(expandHolidays([{ id: 'a', name: 'x', from: '2027-02-11', to: '2027-02-03' }])).toEqual([])
    expect(expandHolidays(undefined)).toEqual([])
    expect(expandHolidays([])).toEqual([])
  })
})

describe('projectHolidayMap', () => {
  const proj = (id: string, holidays?: Holiday[]): Project => ({
    id,
    name: id,
    createdAt: 0,
    holidays,
  })

  it('keys by projectId and skips projects with no holidays', () => {
    const m = projectHolidayMap([
      proj('p1', [{ id: 'h', name: 'Quốc khánh', from: '2026-09-02', to: '2026-09-03' }]),
      proj('p2'),
    ])
    expect(m.get('p1')).toHaveLength(2)
    expect(m.has('p2')).toBe(false)
  })

  it('accepts a single project or nothing at all', () => {
    expect(projectHolidayMap(undefined).size).toBe(0)
    expect(projectHolidayMap(proj('p1', [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-02' }])).size).toBe(1)
  })
})

describe('holidayWorkDays', () => {
  it('counts WORKING days only — weekends inside a run are already off', () => {
    // Feb 3–11 2027 = Wed…Thu, swallowing Sat 6 + Sun 7 → 9 calendar, 7 working.
    expect(holidayWorkDays({ from: '2027-02-03', to: '2027-02-11' })).toBe(7)
  })
  it('a holiday landing entirely on a weekend costs nothing', () => {
    expect(holidayWorkDays({ from: '2027-02-06', to: '2027-02-07' })).toBe(0)
  })
  it('half a single day is 0.5', () => {
    expect(holidayWorkDays({ from: '2026-12-25', to: '2026-12-25', half: 'pm' })).toBe(0.5)
  })
})

describe('holidayLoadInSpan', () => {
  // Wed Feb 3 → Thu Feb 11 2027 (7 working days), plus a one-off in March.
  const hols: Holiday[] = [
    { id: 'a', name: 'Tết', from: '2027-02-03', to: '2027-02-11' },
    { id: 'b', name: 'Giỗ Tổ', from: '2027-03-10', to: '2027-03-10' },
  ]

  it('is empty without a span — a member holding no tasks gets no chip', () => {
    expect(holidayLoadInSpan(hols, null)).toEqual({ days: 0, items: [] })
  })
  it('is empty when the span misses every holiday', () => {
    const r = holidayLoadInSpan(hols, { start: '2027-01-01', end: '2027-02-02' })
    expect(r.days).toBe(0)
    expect(r.items).toEqual([])
  })
  it('clips to the span — a partial overlap costs only its overlapping part', () => {
    // Span ends Fri Feb 5 → only Wed/Thu/Fri of Tết count.
    const r = holidayLoadInSpan(hols, { start: '2027-01-20', end: '2027-02-05' })
    expect(r.days).toBe(3)
    expect(r.items.map((h) => h.id)).toEqual(['a'])
  })
  it('sums across holidays and reports each contributing period once', () => {
    const r = holidayLoadInSpan(hols, { start: '2027-02-01', end: '2027-03-31' })
    expect(r.days).toBe(8) // 7 (Tết) + 1 (Giỗ Tổ, a Wednesday)
    expect(r.items.map((h) => h.name)).toEqual(['Tết', 'Giỗ Tổ'])
  })
  it('drops a holiday whose overlap is all weekend — no chip, no false capacity loss', () => {
    // Sat Feb 6 + Sun Feb 7 are the only days inside this span.
    const r = holidayLoadInSpan(hols, { start: '2027-02-06', end: '2027-02-07' })
    expect(r.days).toBe(0)
    expect(r.items).toEqual([])
  })
  it('keeps half-day weight when the clipped holiday is still a single day', () => {
    const half: Holiday[] = [
      { id: 'c', name: 'Nửa ngày', from: '2027-03-10', to: '2027-03-10', half: 'pm' },
    ]
    expect(holidayLoadInSpan(half, { start: '2027-03-01', end: '2027-03-31' }).days).toBe(0.5)
  })
  it('handles a project with no holidays at all', () => {
    expect(holidayLoadInSpan(undefined, { start: '2027-01-01', end: '2027-12-31' }))
      .toEqual({ days: 0, items: [] })
  })
})

// ── scheduler union ───────────────────────────────────────────────────────

const PID = 'p1'
function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    projectId: PID,
    sequence: 1,
    title: 't',
    assigneeId: null,
    sprintId: 's1',
    status: 'todo',
    priority: 'normal',
    startDate: '2026-09-01', // Tuesday
    dueDate: null,
    estimate: 3,
    createdAt: 0,
    dependsOn: [],
    ...over,
  }
}
const member = (daysOff: Member['daysOff'] = []): Member => ({
  id: 'm1',
  projectId: PID,
  name: 'A',
  color: '#000',
  daysOff,
})
const plan = (t: Task, holidays?: Holiday[], m?: Member) =>
  computeWorkingPlan(
    t,
    new Map([[t.id, t]]),
    m ? new Map([[m.id, m]]) : undefined,
    projectHolidayMap({ id: PID, name: 'p', createdAt: 0, holidays })
  )

describe('scheduler — project holidays', () => {
  it('with no holidays, 3 days of effort from Tue ends Thu', () => {
    expect(plan(task()).dueDate).toBe('2026-09-03')
  })

  it('a holiday pushes the end out, exactly like a personal day off', () => {
    const withHoliday = plan(task(), [
      { id: 'h', name: 'Quốc khánh', from: '2026-09-02', to: '2026-09-03' },
    ])
    // Wed + Thu are gone → the 2nd and 3rd days of work land Fri + Mon.
    expect(withHoliday.dueDate).toBe('2026-09-07')
  })

  it('applies to an UNASSIGNED task — the difference from personal days-off', () => {
    const t = task({ assigneeId: null })
    expect(plan(t).dueDate).toBe('2026-09-03')
    expect(
      plan(t, [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-03' }]).dueDate
    ).toBe('2026-09-07')
  })

  it('unions with the assignee\'s own days off — the later end wins', () => {
    const m = member([{ date: '2026-09-04' }]) // Friday off, personal
    const t = task({ assigneeId: m.id })
    // Personal alone: Tue, Wed, Thu → Thu.
    expect(plan(t, undefined, m).dueDate).toBe('2026-09-03')
    // Plus a holiday on Wed: Tue, Thu, (Fri personal off), Mon.
    expect(
      plan(t, [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-02' }], m).dueDate
    ).toBe('2026-09-07')
  })

  it('member AM-off + holiday PM-off on the same date is a WHOLE day off', () => {
    const m = member([{ date: '2026-09-02', half: 'am' }])
    const t = task({ assigneeId: m.id, estimate: 2 })
    // AM-off alone leaves half of Wed workable → 2 days of effort end Wed.
    expect(plan(t, undefined, m).dueDate).toBe('2026-09-03')
    // Add a PM holiday the same day: nothing left of Wed at all → Tue + Thu.
    const both = plan(t, [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-02', half: 'pm' }], m)
    expect(both.dueDate).toBe('2026-09-03')
    // …and the 3-day version proves the day really contributed zero.
    const three = plan(
      task({ assigneeId: m.id, estimate: 3 }),
      [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-02', half: 'pm' }],
      m
    )
    expect(three.dueDate).toBe('2026-09-04')
  })

  it('a holiday falling on a weekend changes nothing', () => {
    expect(
      plan(task(), [{ id: 'h', name: 'x', from: '2026-09-05', to: '2026-09-06' }]).dueDate
    ).toBe('2026-09-03')
  })

  it('holidays of ANOTHER project do not leak in', () => {
    const map = projectHolidayMap([
      { id: 'other', name: 'o', createdAt: 0, holidays: [{ id: 'h', name: 'x', from: '2026-09-02', to: '2026-09-03' }] },
    ])
    const t = task()
    expect(computeWorkingPlan(t, new Map([[t.id, t]]), undefined, map).dueDate).toBe('2026-09-03')
  })
})

// ── persistence ───────────────────────────────────────────────────────────

describe('setProjectHolidays', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.projects.add({ id: PID, name: 'P', createdAt: 0 })
  })

  it('normalises: swaps a backwards range, drops half on multi-day, sorts, names blanks', async () => {
    const saved = await setProjectHolidays(PID, [
      { id: uid(), name: 'Tết', from: '2027-02-11', to: '2027-02-03' }, // backwards
      { id: uid(), name: '  ', from: '2026-09-02', to: '2026-09-03', half: 'pm' }, // blank + bad half
      { id: uid(), name: 'bad', from: 'nope', to: '2026-01-01' }, // malformed
    ])
    expect(saved).toHaveLength(2)
    expect(saved[0]).toMatchObject({ name: 'Untitled', from: '2026-09-02', to: '2026-09-03' })
    expect(saved[0].half).toBeUndefined()
    expect(saved[1]).toMatchObject({ from: '2027-02-03', to: '2027-02-11' })
  })

  it('keeps half on a genuine single-day holiday', async () => {
    const saved = await setProjectHolidays(PID, [
      { id: uid(), name: 'Party', from: '2026-12-25', to: '2026-12-25', half: 'pm' },
    ])
    expect(saved[0].half).toBe('pm')
  })

  it('reflows every task in the project, including unassigned ones', async () => {
    const t = task({ id: 't1', assigneeId: null })
    await db.tasks.add(t)
    await recomputeDates(t.id)
    expect((await db.tasks.get('t1'))!.dueDate).toBe('2026-09-03')

    await setProjectHolidays(PID, [
      { id: uid(), name: 'Quốc khánh', from: '2026-09-02', to: '2026-09-03' },
    ])
    expect((await db.tasks.get('t1'))!.dueDate).toBe('2026-09-07')

    // Removing the holiday must reflow back, not leave the pushed-out date.
    await setProjectHolidays(PID, [])
    expect((await db.tasks.get('t1'))!.dueDate).toBe('2026-09-03')
  })

  it('leaves other projects untouched', async () => {
    await db.projects.add({ id: 'p2', name: 'P2', createdAt: 0 })
    const other = task({ id: 't2', projectId: 'p2' })
    await db.tasks.add(other)
    await recomputeDates(other.id)
    await setProjectHolidays(PID, [
      { id: uid(), name: 'x', from: '2026-09-02', to: '2026-09-03' },
    ])
    expect((await db.tasks.get('t2'))!.dueDate).toBe('2026-09-03')
  })
})
