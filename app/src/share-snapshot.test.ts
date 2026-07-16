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
import type { Collection, Member, Project, Sprint, Task } from './types'

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

  it('round-trips milestone (effort 0), a child, and a null-parent drop', () => {
    const rich = [
      task('p1', 'a', 1, { estimate: 0, startDate: '2026-07-10' }), // milestone
      task('c1', 'a', 2, { parentId: 'p1', estimate: 2, dueDate: '2026-07-12' }), // child of p1
      task('orphan', 'a', 3, { parentId: 'gone', dueDate: '2026-07-14' }), // parent not in scope → dropped
    ]
    const d = buildSnapshot(project, sprint, [member('a', 'An')], rich)
    // milestone kept as estimate 0; child points at the milestone's new index; orphan flattened
    expect(d.tasks[0].estimate).toBe(0)
    expect(d.tasks[1].parentId).toBe('t0')
    expect(d.tasks[2].parentId).toBeNull()
    expect(decodeSnapshot(encodeSnapshot(d))).toEqual(d)
  })

  it('stays well under the size budget for a big sprint', () => {
    const bigMembers = Array.from({ length: 5 }, (_, i) => member(`u${i}`, `user-${i}`))
    const bigTasks = Array.from({ length: 30 }, (_, i) =>
      task(`b${i}`, `u${i % 5}`, i, { dueDate: '2026-07-2' + (i % 9), startDate: '2026-07-1' + (i % 9), estimate: (i % 5) + 1 })
    )
    const d = buildSnapshot(project, sprint, bigMembers, bigTasks)
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
