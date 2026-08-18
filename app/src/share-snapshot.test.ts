import { describe, expect, it } from 'vitest'
import {
  buildShareUrl,
  buildSnapshot,
  buildCollectionSnapshot,
  decodeSnapshot,
  decodeCollectionSnapshot,
  encodeSnapshot,
  encodeCollectionSnapshot,
  parseShareHash,
  SHARE_MAX_BYTES,
  SNAPSHOT_VERSION,
  COLLECTION_SNAPSHOT_VERSION,
} from './share-snapshot'
import { holidayChipParts, holidayLoadInSpan, holidayWorkDays } from './lib'
import type { Collection, Holiday, Member, Project, Sprint, Task } from './types'

const project: Project = { id: 'p', name: 'Checkout revamp', createdAt: 0 }
const sprint: Sprint = { id: 's', projectId: 'p', name: 'Sprint 12', startDate: '2026-07-05', endDate: '2026-07-22' }

function member(id: string, name: string, over: Partial<Member> = {}): Member {
  return { id, projectId: 'p', name, color: '#c93a0f', daysOff: [], ...over }
}
function task(id: string, assigneeId: string | null, seq: number, over: Partial<Task> = {}): Task {
  return {
    id, projectId: 'p', sequence: seq, title: `Task ${seq}`, assigneeId,
    sprintId: 's', status: 'todo', priority: 'normal',
    startDate: null, dueDate: null, estimate: null, createdAt: seq, dependsOn: [],
    ...over,
  }
}

const members = [member('a', 'An'), member('b', 'Bình')]
const tasks = [
  task('t1', 'a', 12, { dueDate: '2026-07-22', startDate: '2026-07-15', estimate: 3 }),
  task('t2', 'b', 18, { dueDate: '2026-07-19', status: 'in_progress' }),
  task('t3', null, 21),
]

/** Sprint is 2026-07-05 … 2026-07-22. */
function hol(id: string, from: string, to = from, over: Partial<Holiday> = {}): Holiday {
  return { id, name: `Hol ${id}`, from, to, ...over }
}

describe('project holidays on the wire (hd)', () => {
  it('carries only the runs overlapping the sprint, with ids renumbered', () => {
    const withHols: Project = {
      ...project,
      holidays: [
        hol('x1', '2026-06-01'), // entirely before the sprint
        hol('x2', '2026-07-10', '2026-07-13'), // inside
        hol('x3', '2026-07-22'), // last day — inclusive, kept
        hol('x4', '2026-07-23'), // day after — dropped
      ],
    }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(d.holidays.map((h) => [h.id, h.from, h.to])).toEqual([
      ['h0', '2026-07-10', '2026-07-13'],
      ['h1', '2026-07-22', '2026-07-22'],
    ])
  })

  it('round-trips through encode/decode, half-day included', () => {
    const withHols: Project = {
      ...project,
      holidays: [hol('x', '2026-07-10', '2026-07-13'), hol('y', '2026-07-16', '2026-07-16', { half: 'pm' })],
    }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(decodeSnapshot(encodeSnapshot(d))).toEqual(d)
  })

  it('CLIPS a run that straddles the sprint edge, so label and total agree', () => {
    // Unclipped, the chip printed "Jun 29 – Jul 7" beside a total of 2d, because
    // holidayLoadInSpan clips internally when it counts. Clip on the wire instead.
    const withHols: Project = { ...project, holidays: [hol('x', '2026-06-29', '2026-07-07')] }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(d.holidays[0]).toMatchObject({ from: '2026-07-05', to: '2026-07-07' })
    const rt = decodeSnapshot(encodeSnapshot(d))!
    expect(rt.holidays[0]).toMatchObject({ from: '2026-07-05', to: '2026-07-07' })
    // The printed range now spans exactly the days the total counts.
    const span = { start: sprint.startDate, end: sprint.endDate! }
    expect(holidayLoadInSpan(rt.holidays, span).days).toBe(
      holidayWorkDays({ from: rt.holidays[0].from, to: rt.holidays[0].to })
    )
  })

  it('matches the app for every boundary shape (same clipped list, same number)', () => {
    const span = { start: sprint.startDate, end: sprint.endDate! }
    const cases: [string, string, string, ('am' | 'pm')?][] = [
      ['straddles the start', '2026-06-29', '2026-07-07'],
      ['straddles the end', '2026-07-20', '2026-07-25'],
      ['swallows the sprint', '2026-06-01', '2026-08-01'],
      // Clipping turns this into a SINGLE day, which is what resurrects `half`:
      // unclipped it counted 1 whole day, the app counted 0.5.
      ['clipped down to one day, half kept', '2026-07-22', '2026-07-25', 'pm'],
    ]
    for (const [label, from, to, half] of cases) {
      const hols = [{ id: 'x', name: 'H', from, to, ...(half ? { half } : {}) }]
      // What the app renders: ProjectHolidays clips the same way.
      const appList = hols.map((h) => ({
        ...h,
        from: h.from < span.start ? span.start : h.from,
        to: h.to > span.end ? span.end : h.to,
      }))
      const rt = decodeSnapshot(encodeSnapshot(buildSnapshot({ ...project, holidays: hols }, sprint, members, tasks)))!
      expect(holidayLoadInSpan(rt.holidays, span).days, label).toBe(holidayLoadInSpan(appList, span).days)
    }
  })

  it('never lets a half-day badge ride a multi-day run', () => {
    // The badge and the total are decided by the same rule now. Before, a 5-day
    // run kept `half` across the wire and printed "½AM" beside a total of 5d.
    const hols = [{ id: 'x', name: 'Tet', from: '2026-07-06', to: '2026-07-10', half: 'am' as const }]
    const rt = decodeSnapshot(encodeSnapshot(buildSnapshot({ ...project, holidays: hols }, sprint, members, tasks)))!
    expect(rt.holidays[0].half).toBeUndefined()
    expect(holidayChipParts(rt.holidays[0], (d) => d).half).toBeNull()
    expect(holidayLoadInSpan(rt.holidays, { start: sprint.startDate, end: sprint.endDate! }).days).toBe(5)
  })

  it('sorts by date, so a legacy unsorted project still reads in order', () => {
    const withHols: Project = {
      ...project,
      holidays: [hol('c', '2026-07-20'), hol('a', '2026-07-06'), hol('b', '2026-07-13')],
    }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(d.holidays.map((h) => h.from)).toEqual(['2026-07-06', '2026-07-13', '2026-07-20'])
  })

  it('keeps holiday ids stable when a run is dropped', () => {
    // '2026-07-1x' passes the lexical overlap test but Date.parse rejects it, so
    // it is the shape that used to survive the build and die at pack time —
    // renumbering the survivors on only one side and breaking the round-trip.
    const withHols: Project = { ...project, holidays: [hol('bad', '2026-07-1x', '2026-07-2x'), hol('ok', '2026-07-10')] }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(d.holidays.map((h) => h.from)).toEqual(['2026-07-10']) // dropped at BUILD, not at pack
    expect(decodeSnapshot(encodeSnapshot(d))).toEqual(d) // ids line up, so this holds
  })

  it('a hostile link can neither hang nor crash the viewer', () => {
    // A share blob is fully attacker-controlled: it rides in a URL fragment, or in
    // a KV store keyed by a public id. These three shapes each used to be fatal.
    const raw = (extra: Record<string, unknown>) =>
      LZString.compressToEncodedURIComponent(
        JSON.stringify({
          v: 2, ts: '', pj: 'p', sn: 's', d0: '2026-07-05', d1: '2026-07-22',
          mb: [['An', '#111', '', '']],
          ti: ['T'], ss: [0], pp: [2], am: [0], pa: [-1], ef: [null], s0: [null], s1: [null],
          ...extra,
        })
      )

    // 1. Out-of-Date-range offset. `new Date(...).toISOString()` threw RangeError,
    //    and decode runs inside a render useMemo with no error boundary above it,
    //    so that throw was a blank page. It now fails closed PER FIELD: the bad row
    //    is dropped and the rest of the snapshot still renders.
    const huge = decodeSnapshot(raw({ hd: [[1e12, 1e12, 0, 'X']] }))
    expect(huge).not.toBeNull()
    expect(huge!.holidays).toEqual([])
    expect(huge!.members).toHaveLength(1) // the board survives one bad holiday
    // `JSON.parse('1e999')` is Infinity, so the literal has to survive into the
    // TEXT — `JSON.stringify(Infinity)` writes `null` and would test nothing.
    const infinite = LZString.compressToEncodedURIComponent(
      JSON.stringify({
        v: 2, ts: '', pj: 'p', sn: 's', d0: '2026-07-05', d1: '2026-07-22',
        mb: [['An', '#111', '', '']],
        ti: ['T'], ss: [0], pp: [2], am: [0], pa: [-1], ef: [null], s0: [null], s1: [null],
        hd: [['__INF__', 0, 0, 'X']],
      }).replace('"__INF__"', '1e999')
    )
    expect(decodeSnapshot(infinite)!.holidays).toEqual([])
    // Same hole, pre-existing column: a huge task offset degrades to no date.
    expect(decodeSnapshot(raw({ s0: [1e12] }))!.tasks[0].startDate).toBeNull()

    // 2. A span shaped like a date but 3.65 million days long. The old walk
    //    stepped by STRING successor, and past 9999-12-31 that successor is its
    //    own fixed point AND sorts below every real date, so it never terminated.
    //    168 chars was enough to freeze the tab.
    const bomb = raw({ d0: '0001-01-01', d1: '9999-12-31', hd: [[0, 3652058, 0, 'boom']] })
    const d = decodeSnapshot(bomb)
    expect(d).not.toBeNull()
    const t0 = Date.now()
    const load = holidayLoadInSpan(d!.holidays, { start: d!.sprint.startDate, end: d!.sprint.endDate! })
    expect(Date.now() - t0).toBeLessThan(1000) // was: never returned
    expect(load.days).toBe(0) // over the cap, so it contributes nothing

    // 3. Junk rows are skipped, valid neighbours survive, nothing throws.
    const mixed = decodeSnapshot(raw({ hd: [7, null, ['x', 3, 0, 'BadFrom'], [1, 1, 99, 'BadHalfCode'], [2, 3, 1, 'Ok']] }))!
    expect(mixed.holidays.map((h) => [h.from, h.to, h.half ?? null, h.name])).toEqual([
      ['2026-07-06', '2026-07-06', null, 'BadHalfCode'],
      ['2026-07-07', '2026-07-08', null, 'Ok'],
    ])

    // 4. A malformed sprint range is rejected outright, not carried into the walk.
    expect(decodeSnapshot(raw({ d0: 'nope' }))).toBeNull()
    expect(decodeSnapshot(raw({ d1: '9999-13-99x' }))).toBeNull()
  })

  it('caps how many holiday rows a blob can decode into', () => {
    const many = Array.from({ length: 500 }, (_, i) => [i % 17, (i % 17) + 1, 0, `H${i}`])
    const blob = LZString.compressToEncodedURIComponent(
      JSON.stringify({
        v: 2, ts: '', pj: 'p', sn: 's', d0: '2026-07-05', d1: '2026-07-22',
        mb: [['An', '#111', '', '']],
        ti: ['T'], ss: [0], pp: [2], am: [0], pa: [-1], ef: [null], s0: [null], s1: [null],
        hd: many,
      })
    )
    // Each surviving row becomes a rendered span AND a day-walk; lz-string reaches
    // ~150:1 on repeated rows, so MAX_BLOB_LEN alone does not bound this.
    expect(decodeSnapshot(blob)!.holidays.length).toBe(64)
  })

  it('omits the hd key entirely when the sprint has no holidays', () => {
    // Same deal as `nt`: no key at all, so the blob of a normal sprint pays nothing.
    const d = buildSnapshot(project, sprint, members, tasks)
    expect(d.holidays).toEqual([])
    const blob = encodeSnapshot(d)
    expect(decodeSnapshot(blob)!.holidays).toEqual([])
    expect(JSON.stringify(d)).not.toContain('"hd"')
  })

  it('decodes a pre-holidays blob (no hd) to an empty list', () => {
    // Backward compat is the whole reason `hd` is optional and `v` stayed 2.
    const d = buildSnapshot(project, sprint, members, tasks)
    const decoded = decodeSnapshot(encodeSnapshot(d))
    expect(decoded).not.toBeNull()
    expect(decoded!.holidays).toEqual([])
    expect(decoded!.members.length).toBe(2) // the rest still decodes
  })

  it('drops a non-ISO run at build', () => {
    // 'nope' never reached the wire in the first place: 'nope' <= '2026-07-22' is
    // false, so the overlap filter already discarded it. The claim this test used
    // to make (that it survived the build) was backwards.
    const withHols: Project = { ...project, holidays: [hol('bad', 'nope', 'nope'), hol('ok', '2026-07-10')] }
    const d = buildSnapshot(withHols, sprint, members, tasks)
    expect(d.holidays.map((h) => h.from)).toEqual(['2026-07-10'])
  })
})

describe('buildSnapshot', () => {
  it('scopes to the one sprint and normalizes ids/fields', () => {
    const d = buildSnapshot(project, sprint, members, tasks)
    expect(d.project.name).toBe('Checkout revamp')
    expect(d.sprint).toEqual({ name: 'Sprint 12', startDate: '2026-07-05', endDate: '2026-07-22' })
    expect(d.tasks).toHaveLength(3)
    // synthetic ids, assignee remapped to member index
    expect(d.members.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(d.tasks.map((t) => t.id)).toEqual(['t0', 't1', 't2'])
    expect(d.tasks[0].assigneeId).toBe('m0')
    expect(d.tasks[2].assigneeId).toBeNull()
  })

  it('carries only members that own a task in scope', () => {
    const d = buildSnapshot(project, sprint, members, tasks)
    expect(d.members.map((m) => m.name).sort()).toEqual(['An', 'Bình'])
  })

  it('drops avatarImage from the payload (biggest bloat source)', () => {
    const withImg = [member('a', 'An', { avatarImage: 'data:image/png;base64,AAAA', avatarEmoji: '🦊' }), member('b', 'Bình')]
    const d = buildSnapshot(project, sprint, withImg, tasks)
    expect(d.members[0].avatarImage).toBeUndefined()
    expect(d.members[0].avatarEmoji).toBe('🦊')
  })

  it('carries the member title (role label) through encode/decode', () => {
    const withTitle = [member('a', 'An', { title: 'Backend Engineer' }), member('b', 'Bình')]
    const d = buildSnapshot(project, sprint, withTitle, tasks)
    expect(d.members[0].title).toBe('Backend Engineer')
    expect(d.members[1].title).toBeUndefined()
    const decoded = decodeSnapshot(encodeSnapshot(d))!
    expect(decoded.members[0].title).toBe('Backend Engineer')
    expect(decoded.members[1].title).toBeUndefined()
  })

  it('carries the sprint goal note through encode/decode', () => {
    const withNote: Sprint = { ...sprint, note: 'Ship checkout v2\nfocus on mobile' }
    const d = buildSnapshot(project, withNote, members, tasks)
    expect(d.sprint.note).toBe('Ship checkout v2\nfocus on mobile')
    const decoded = decodeSnapshot(encodeSnapshot(d))!
    expect(decoded.sprint.note).toBe('Ship checkout v2\nfocus on mobile')
  })

  it('leaves the sprint note undefined when absent (no empty string)', () => {
    const d = buildSnapshot(project, sprint, members, tasks)
    expect(d.sprint.note).toBeUndefined()
    expect(decodeSnapshot(encodeSnapshot(d))!.sprint.note).toBeUndefined()
  })

  it('carries the member off-days (dates + half) within the sprint range, sorted', () => {
    // sprint range is 2026-07-05 … 2026-07-22.
    const withOff = [
      member('a', 'An', {
        daysOff: [
          { date: '2026-07-11', half: 'am' }, // half day, in range (given out of order)
          { date: '2026-07-10' }, // full day, in range
          { date: '2026-06-01' }, // out of range → dropped
        ],
      }),
      member('b', 'Bình'),
    ]
    const d = buildSnapshot(project, sprint, withOff, tasks)
    const ai = d.members.findIndex((m) => m.name === 'An')
    const bi = d.members.findIndex((m) => m.name === 'Bình')
    // trimmed to range + sorted by date
    expect(d.membersOff[ai]).toEqual([{ date: '2026-07-10' }, { date: '2026-07-11', half: 'am' }])
    expect(d.membersOff[bi]).toEqual([])
    const decoded = decodeSnapshot(encodeSnapshot(d))!
    expect(decoded.membersOff[ai]).toEqual([{ date: '2026-07-10' }, { date: '2026-07-11', half: 'am' }])
    expect(decoded.membersOff[bi]).toEqual([])
  })

  it('widens the off-day range to cover a task that sits past the sprint end', () => {
    // A rolled-over-style task dated AFTER the sprint end (sprint ends 2026-07-22);
    // an off-day overlapping that task must survive even though it's outside the
    // sprint window — the "few tasks / off dropped" bug. See share-link-snapshot.md.
    const lateTask = task('late', 'a', 30, {
      startDate: '2026-07-25',
      dueDate: '2026-07-26',
      status: 'in_progress',
    })
    const withOff = [
      member('a', 'An', {
        daysOff: [
          { date: '2026-07-25', half: 'am' }, // outside sprint, inside the task span → kept
          { date: '2026-08-10' }, // outside sprint AND task span → dropped
        ],
      }),
    ]
    const d = buildSnapshot(project, sprint, withOff, [lateTask])
    const ai = d.members.findIndex((m) => m.name === 'An')
    expect(d.membersOff[ai]).toEqual([{ date: '2026-07-25', half: 'am' }])
  })

  it('round-trips a pm half-day off (exercises HALF_CODE[2])', () => {
    const withPm = [member('a', 'An', { daysOff: [{ date: '2026-07-14', half: 'pm' }] }), member('b', 'Bình')]
    const d = buildSnapshot(project, sprint, withPm, tasks)
    const ai = d.members.findIndex((m) => m.name === 'An')
    expect(decodeSnapshot(encodeSnapshot(d))!.membersOff[ai]).toEqual([{ date: '2026-07-14', half: 'pm' }])
  })

  it('bakes a parent task status as the rollup of its children (not its raw status)', () => {
    const parent = task('p', 'a', 1, { title: 'Parent' }) // raw status 'todo'
    const child = task('c', 'a', 2, { title: 'Child', parentId: 'p', status: 'in_progress' })
    const d = buildSnapshot(project, sprint, members, [parent, child])
    const p = d.tasks.find((t) => t.title === 'Parent')!
    const c = d.tasks.find((t) => t.title === 'Child')!
    expect(p.status).toBe('in_progress') // derived from child, not raw 'todo'
    expect(c.status).toBe('in_progress') // leaf keeps its own status
  })

  it('bakes a parent task effort as the SUM of its children (not its raw null estimate)', () => {
    const parent = task('p', 'a', 1, { title: 'Parent' }) // container: estimate null
    const c1 = task('c1', 'a', 2, { title: 'C1', parentId: 'p', estimate: 3 })
    const c2 = task('c2', 'a', 3, { title: 'C2', parentId: 'p', estimate: 1.5 })
    const d = buildSnapshot(project, sprint, members, [parent, c1, c2])
    expect(d.tasks.find((t) => t.title === 'Parent')!.estimate).toBe(4.5) // 3 + 1.5, not null
    expect(d.tasks.find((t) => t.title === 'C1')!.estimate).toBe(3) // leaf keeps its own
  })

  it('leaves a parent effort null when no child is estimated', () => {
    const parent = task('p', 'a', 1, { title: 'Parent' })
    const child = task('c', 'a', 2, { title: 'Child', parentId: 'p' }) // estimate null
    const d = buildSnapshot(project, sprint, members, [parent, child])
    expect(d.tasks.find((t) => t.title === 'Parent')!.estimate).toBeNull()
  })

  it('bakes a parent date span from its children (not the parent\'s own/null dates)', () => {
    // Parent's OWN dates are ignored in-app (scheduler spans the children); a
    // container often has null dates, so the share page would show "—" without this.
    const parent = task('p', 'a', 1, { title: 'Parent', startDate: null, dueDate: null })
    const c1 = task('c1', 'a', 2, { title: 'C1', parentId: 'p', startDate: '2026-07-09', dueDate: '2026-07-11' })
    const c2 = task('c2', 'a', 3, { title: 'C2', parentId: 'p', startDate: '2026-07-14', dueDate: '2026-07-20' })
    const d = buildSnapshot(project, sprint, members, [parent, c1, c2])
    const p = d.tasks.find((t) => t.title === 'Parent')!
    expect(p.startDate).toBe('2026-07-09') // earliest child start
    expect(p.dueDate).toBe('2026-07-20') // latest child due
  })

  it('rolls a parent up from ALL children even when a child is trimmed out of the share', () => {
    // Parent p (unassigned → always kept). Children: one for An, one for Bình.
    const parent = task('p', null, 1, { title: 'P' })
    const cA = task('ca', 'a', 2, { title: 'CA', parentId: 'p', status: 'in_progress' })
    const cB = task('cb', 'b', 3, { title: 'CB', parentId: 'p', status: 'todo' })
    // Share scoped to Bình only → CA (An's child) is dropped from the payload.
    const d = buildSnapshot(project, sprint, members, [parent, cA, cB], { memberIds: ['b'] })
    expect(d.tasks.some((t) => t.title === 'CA')).toBe(false) // trimmed away
    // Parent status still reflects CA's in_progress (frozen from the full child set).
    expect(d.tasks.find((t) => t.title === 'P')!.status).toBe('in_progress')
  })

  it('narrows tasks + members to one assignee when scoped', () => {
    const d = buildSnapshot(project, sprint, members, tasks, { memberId: 'a' })
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0].assigneeId).toBe('m0')
    expect(d.members.map((m) => m.name)).toEqual(['An'])
  })

  it('memberIds scope keeps only chosen members but always keeps unassigned tasks', () => {
    // pick only Bình; t2 (Bình) + t3 (unassigned) stay, t1 (An) dropped.
    const d = buildSnapshot(project, sprint, members, tasks, { memberIds: ['b'] })
    expect(d.tasks).toHaveLength(2)
    expect(d.members.map((m) => m.name)).toEqual(['Bình'])
    expect(d.tasks.some((t) => t.assigneeId === null)).toBe(true)
  })

  it('memberIds = [] leaves just the unassigned tasks', () => {
    const d = buildSnapshot(project, sprint, members, tasks, { memberIds: [] })
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0].assigneeId).toBeNull()
    expect(d.members).toHaveLength(0)
  })

  it('ignores tasks from other sprints', () => {
    const foreign = task('x', 'a', 99, { sprintId: 'other' })
    const d = buildSnapshot(project, sprint, members, [...tasks, foreign])
    expect(d.tasks).toHaveLength(3)
  })
})

describe('encode / decode round-trip', () => {
  it('decodes back to an equal snapshot (frozen dates preserved)', () => {
    const d = buildSnapshot(project, sprint, members, tasks)
    const decoded = decodeSnapshot(encodeSnapshot(d))
    expect(decoded).toEqual(d)
  })

  it('round-trips milestone (effort 0), a group child, and a null-parent drop', () => {
    // Milestones are leaves (a checkpoint), groups are the only parents — keep them
    // distinct so the effort rollup (parent = sum of children) doesn't rewrite the
    // milestone's own 0.
    const rich = [
      task('m1', 'a', 1, { estimate: 0, startDate: '2026-07-10' }), // milestone leaf
      task('grp', 'a', 2, { title: 'Grp' }), // a real parent (container, estimate null)
      task('c1', 'a', 3, { parentId: 'grp', estimate: 2, dueDate: '2026-07-12' }), // its child
      task('orphan', 'a', 4, { parentId: 'gone', dueDate: '2026-07-14' }), // parent not in scope → dropped
    ]
    const d = buildSnapshot(project, sprint, [member('a', 'An')], rich)
    expect(d.tasks[0].estimate).toBe(0) // milestone leaf keeps its own 0
    expect(d.tasks[1].estimate).toBe(2) // parent effort rolled up from its child
    expect(d.tasks[2].parentId).toBe('t1') // child points at the parent's new index
    expect(d.tasks[3].parentId).toBeNull() // orphan flattened
    expect(decodeSnapshot(encodeSnapshot(d))).toEqual(d)
  })

  it('stays well under the size budget for a big sprint', () => {
    const bigMembers = Array.from({ length: 5 }, (_, i) => member(`u${i}`, `user-${i}`))
    const bigTasks = Array.from({ length: 30 }, (_, i) =>
      task(`b${i}`, `u${i % 5}`, i, { dueDate: '2026-07-2' + (i % 9), startDate: '2026-07-1' + (i % 9), estimate: (i % 5) + 1 })
    )
    // Holidays are inside the budget on purpose: `hd` carries the first unbounded
    // free text added to the wire since task titles, and the fixture used to have
    // none, so `hd` contributed 0 bytes to the one size assertion that exists.
    const bigHols = [
      hol('a', '2026-07-06', '2026-07-08'),
      hol('b', '2026-07-13'),
      hol('c', '2026-07-20', '2026-07-21'),
    ].map((h, i) => ({ ...h, name: ['Tết Nguyên đán', 'Giỗ Tổ Hùng Vương', 'Quốc khánh mùng 2 tháng 9'][i] }))
    const d = buildSnapshot({ ...project, holidays: bigHols }, sprint, bigMembers, bigTasks)
    expect(d.holidays).toHaveLength(3)
    const url = buildShareUrl(encodeSnapshot(d), 'https://plan-up.app/')
    expect(url.length).toBeLessThan(SHARE_MAX_BYTES)
    expect(decodeSnapshot(parseShareHash(new URL(url).hash)!.blob)).toEqual(d)
  })

  it('returns null for garbage / empty / non-snapshot payloads', () => {
    expect(decodeSnapshot('')).toBeNull()
    expect(decodeSnapshot('not-a-real-lz-blob!!!')).toBeNull()
    expect(decodeSnapshot(encodeRaw(JSON.stringify({ hello: 'world' })))).toBeNull()
    // right container, wrong version
    expect(decodeSnapshot(encodeRaw(JSON.stringify({ v: 1, pj: 'x' })))).toBeNull()
    // v2 but column lengths mismatch
    expect(
      decodeSnapshot(encodeRaw(JSON.stringify({ v: 2, pj: 'x', sn: 'y', d0: '2026-07-05', mb: [], ti: ['a'], ss: [], pp: [], am: [], pa: [], ef: [], s0: [], s1: [] })))
    ).toBeNull()
  })

  it('decodes a PRE-title/note/off blob (3-cell mb, no nt, no mo) — backward compatible', () => {
    // Exactly the shape the app wrote before title/note/days-off travelled.
    const old = {
      v: 2, ts: '2026-07-01T00:00:00.000Z', pj: 'Old proj', sn: 'Old sprint',
      d0: '2026-07-05', d1: '2026-07-22',
      mb: [['An', '#111', ''], ['Bình', '#222', '🦊']], // 3 cells, no title
      ti: ['Task X'], ss: [1], pp: [2], am: [0], pa: [-1], ef: [null], s0: [null], s1: [3],
    }
    const d = decodeSnapshot(encodeRaw(JSON.stringify(old)))!
    expect(d).not.toBeNull()
    expect(d.sprint.note).toBeUndefined() // no nt
    expect(d.members[0].title).toBeUndefined() // no 4th mb cell
    expect(d.members[1].avatarEmoji).toBe('🦊')
    expect(d.membersOff).toEqual([[], []]) // no mo → empty per member
  })

  it('tolerates a malformed / short `mo` without crashing', () => {
    const bad = {
      v: 2, ts: '', pj: 'p', sn: 's', d0: '2026-07-05', d1: null,
      mb: [['An', '#111', '', 'Eng'], ['Bình', '#222', '', '']],
      // mo: junk pairs, non-array entry, and shorter than mb (only 1 of 2 members)
      mo: [[[3, 1], ['x', 2], [5, 99], 7, null]],
      ti: ['T'], ss: [1], pp: [2], am: [0], pa: [-1], ef: [null], s0: [null], s1: [3],
    }
    const d = decodeSnapshot(encodeRaw(JSON.stringify(bad)))!
    expect(d).not.toBeNull()
    // valid pairs survive ([3,1]→am, [5,99]→bad halfcode→full day); junk dropped
    expect(d.membersOff[0]).toEqual([{ date: '2026-07-08', half: 'am' }, { date: '2026-07-10' }])
    expect(d.membersOff[1]).toEqual([]) // short mo → empty for the missing member
  })
})

describe('parseShareHash / buildShareUrl', () => {
  it('extracts version + blob from a #v=2&s=… hash', () => {
    expect(parseShareHash('#v=2&s=ABC123')).toEqual({ version: 2, blob: 'ABC123' })
    expect(parseShareHash('v=2&s=ABC123')).toEqual({ version: 2, blob: 'ABC123' }) // leading # optional
  })

  it('accepts the collection version (v=3) and rejects unknown / missing blob', () => {
    expect(parseShareHash('#v=3&s=ABC')).toEqual({ version: 3, blob: 'ABC' }) // collection format
    expect(parseShareHash('#v=1&s=ABC')).toBeNull() // old v1 no longer decodes
    expect(parseShareHash('#v=4&s=ABC')).toBeNull() // unknown version
    expect(parseShareHash('#s=ABC')).toBeNull()
    expect(parseShareHash('#v=2')).toBeNull()
    expect(parseShareHash('')).toBeNull()
  })

  it('preserves a "+" in the blob (not turned into a space)', () => {
    expect(parseShareHash('#v=2&s=aa+bb/cc')).toEqual({ version: 2, blob: 'aa+bb/cc' })
  })

  it('round-trips through buildShareUrl', () => {
    const blob = encodeSnapshot(buildSnapshot(project, sprint, members, tasks))
    const url = buildShareUrl(blob, 'https://plan-up.app/')
    expect(url).toBe(`https://plan-up.app/#v=${SNAPSHOT_VERSION}&s=${blob}`)
    expect(parseShareHash(new URL(url).hash)).toEqual({ version: SNAPSHOT_VERSION, blob })
  })
})

// ── Collection snapshots (v3) ──────────────────────────────────────────────
const collection: Collection = {
  id: 'c', projectId: 'p', name: 'Live-ops 2026', order: 0, createdAt: 0,
  sections: [
    { id: 'sec1', name: 'Q3 Launches', color: '#ff9500' },
    { id: 'sec2', name: 'Events', color: '#0071e3' },
  ],
  statuses: [
    { id: 'st1', name: 'FEATURE', color: '#ff9500' },
    { id: 'st2', name: 'EVENT', color: '#0071e3' },
  ],
}
function collItem(id: string, over: Partial<Task> = {}): Task {
  return {
    id, projectId: 'p', sequence: 0, title: `Item ${id}`, assigneeId: null,
    sprintId: null, status: 'todo', priority: 'none',
    startDate: null, dueDate: null, estimate: null, createdAt: 0, dependsOn: [],
    collectionId: 'c', sectionId: 'sec1', collectionStatusId: 'st1', ...over,
  }
}
const collTasks = [
  collItem('i1', { sectionId: 'sec1', collectionStatusId: 'st1', startDate: '2026-07-03', dueDate: '2026-07-18', listOrder: 0 }),
  collItem('i2', { sectionId: 'sec2', collectionStatusId: 'st2', startDate: '2026-07-05', dueDate: null, listOrder: 1 }),
  collItem('i3', { sectionId: 'sec1', collectionStatusId: null, startDate: null, dueDate: null, listOrder: 2 }),
  // A stray sprint task + a task from another collection must NOT leak in.
  task('x1', 'a', 99),
  collItem('i9', { collectionId: 'other', sectionId: 'sec1' }),
]

describe('buildCollectionSnapshot', () => {
  it('scopes to the one collection, keeps sections in use + all statuses', () => {
    const d = buildCollectionSnapshot(project, collection, collTasks)
    expect(d.project.name).toBe('Checkout revamp')
    expect(d.collection).toEqual({ name: 'Live-ops 2026' })
    expect(d.items).toHaveLength(3) // sprint task + other-collection item excluded
    expect(d.sections.map((s) => s.name)).toEqual(['Q3 Launches', 'Events'])
    expect(d.statuses.map((s) => s.name)).toEqual(['FEATURE', 'EVENT'])
    // synthetic ids, item references remapped
    expect(d.sections[0].id).toBe('s0')
    expect(d.items[0]).toMatchObject({ title: 'Item i1', sectionId: 's0', statusId: 'x0', startDate: '2026-07-03', dueDate: '2026-07-18' })
    expect(d.items.find((i) => i.title === 'Item i3')).toMatchObject({ statusId: null }) // no status
  })

  it('trims to selected sections', () => {
    const d = buildCollectionSnapshot(project, collection, collTasks, { sectionIds: ['sec2'] })
    expect(d.items).toHaveLength(1)
    expect(d.sections.map((s) => s.name)).toEqual(['Events'])
  })

  it('round-trips through encode/decode with absolute dates', () => {
    const d = buildCollectionSnapshot(project, collection, collTasks)
    expect(decodeCollectionSnapshot(encodeCollectionSnapshot(d))).toEqual(d)
  })

  it('stays well under the size budget', () => {
    const blob = encodeCollectionSnapshot(buildCollectionSnapshot(project, collection, collTasks))
    const url = buildShareUrl(blob, 'https://plan-up.app/', COLLECTION_SNAPSHOT_VERSION)
    expect(url).toContain(`#v=${COLLECTION_SNAPSHOT_VERSION}&s=`)
    expect(url.length).toBeLessThan(SHARE_MAX_BYTES)
    expect(parseShareHash(new URL(url).hash)).toEqual({ version: COLLECTION_SNAPSHOT_VERSION, blob })
  })

  it('returns null for a v2 blob (wrong version) and garbage', () => {
    const v2 = encodeSnapshot(buildSnapshot(project, sprint, members, tasks))
    expect(decodeCollectionSnapshot(v2)).toBeNull()
    expect(decodeCollectionSnapshot('')).toBeNull()
    expect(decodeCollectionSnapshot('not-lz!!!')).toBeNull()
  })
})

// Helper: compress an arbitrary JSON string the same way encodeSnapshot does,
// so we can feed decodeSnapshot a valid-but-wrong payload.
import LZString from 'lz-string'
function encodeRaw(json: string): string {
  return LZString.compressToEncodedURIComponent(json)
}
