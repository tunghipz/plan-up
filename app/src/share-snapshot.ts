import LZString from 'lz-string'
import type { Collection, Member, Priority, Project, Sprint, Status, Task } from './types'
import { byEnd } from './telegram-export'

/**
 * Share a sprint as a read-only snapshot packed into the URL fragment (`#s=…`).
 * Pure — no React, no DOM, no Dexie — so the encode/decode grammar is unit-tested
 * in isolation (share-snapshot.test.ts). See design-docs/share-link-snapshot.md.
 *
 * The viewer only ever DISPLAYS the snapshot (no import, no write), so the payload
 * carries just the fields the board draws — not a full ProjectBundle. It is packed
 * COMPACT v2: columnar arrays (no repeated keys), status/priority as enum ints,
 * members carried once with tasks referencing them BY INDEX, and dates as integer
 * day-offsets from the sprint start. Everything lives after the URL `#`, which
 * browsers never send to a server — so the snapshot only exists in the two
 * people's browsers. Dates are FROZEN (already computed); the viewer never
 * re-runs scheduling.
 */

export const SNAPSHOT_VERSION = 2
/** Collection snapshots use a distinct wire format (section-grouped, no members,
 * user-defined statuses, absolute dates). v2 (sprint) stays untouched. */
export const COLLECTION_SNAPSHOT_VERSION = 3
/** Snapshot versions this build knows how to decode (boot picks the viewer). */
const KNOWN_VERSIONS = new Set([SNAPSHOT_VERSION, COLLECTION_SNAPSHOT_VERSION])

/** Warn threshold for the whole share URL (characters). The blob rides in the URL
 * *fragment* (`#v=2&s=…`), which is never sent to a server, so the classic ~8 KB
 * request-line limit doesn't apply and browsers handle far longer. The real limit
 * is the paste target: chat apps cap a single message (Telegram ~4096 chars) and
 * silently truncate past it. 4000 sits just under that — a typical snapshot is
 * ~1 KB, so this only fires on genuinely huge sprints. */
export const SHARE_MAX_BYTES = 4000

// Reject an absurdly long blob before decompressing (cheap decompression-bomb
// guard). No real sprint snapshot comes close.
const MAX_BLOB_LEN = 200_000

// Fixed enum tables — the packed form stores the index; order must stay stable.
const STATUS_CODE: Status[] = ['todo', 'in_progress', 'done']
const PRIO_CODE: Priority[] = ['none', 'low', 'normal', 'high', 'urgent']

/**
 * The normalized in-memory snapshot both sender and viewer speak. Ids are
 * synthetic indices (`m0…` / `t0…`) and members carry no `avatarImage` (a data-URL
 * would dominate the payload); `sequence` = array position so `byEnd`'s tie-break
 * reproduces display order. `buildSnapshot` emits this shape directly, so
 * `decodeSnapshot(encodeSnapshot(x))` round-trips to an equal object.
 */
export interface SnapshotData {
  exportedAt: string
  project: { name: string }
  sprint: { name: string; startDate: string; endDate: string | null }
  members: Member[]
  tasks: Task[]
}

/** Integer day-offset of `d` from `base` (both yyyy-mm-dd); null when either absent/bad. */
function toOffset(base: string, d: string | null | undefined): number | null {
  if (!d) return null
  const b = Date.parse(base.slice(0, 10) + 'T00:00:00Z')
  const x = Date.parse(d.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(b) || Number.isNaN(x)) return null
  return Math.round((x - b) / 86_400_000)
}

/** Inverse of {@link toOffset}: `base` + `n` days → yyyy-mm-dd; null when absent/bad. */
function fromOffset(base: string, n: number | null | undefined): string | null {
  if (n == null) return null
  const b = Date.parse(base.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(b)) return null
  return new Date(b + n * 86_400_000).toISOString().slice(0, 10)
}

/** A member reduced to what the board renders, with a synthetic id + no avatar image. */
function normMember(m: Member, i: number): Member {
  return { id: `m${i}`, projectId: '', name: m.name, color: m.color, daysOff: [], avatarEmoji: m.avatarEmoji }
}

/** A task reduced to display fields, ids remapped to indices, dates trimmed to yyyy-mm-dd. */
function normTask(
  t: Task,
  i: number,
  memberIdx: Map<string, number>,
  taskIdx: Map<string, number>
): Task {
  const assignee = t.assigneeId != null && memberIdx.has(t.assigneeId) ? `m${memberIdx.get(t.assigneeId)}` : null
  const parent = t.parentId && taskIdx.has(t.parentId) ? `t${taskIdx.get(t.parentId)}` : null
  return {
    id: `t${i}`,
    projectId: '',
    sprintId: '',
    createdAt: 0,
    dependsOn: [],
    sequence: i,
    title: t.title,
    status: t.status,
    priority: t.priority,
    estimate: t.estimate,
    startDate: t.startDate ? t.startDate.slice(0, 10) : null,
    dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null,
    assigneeId: assignee,
    parentId: parent,
  }
}

/**
 * Build the normalized snapshot for ONE sprint from IN-MEMORY app data (no Dexie
 * read — the App already holds these on screen). Scope options:
 * - `memberId` — a single assignee (legacy single-scope).
 * - `memberIds` — a set of assignees to KEEP; unassigned tasks are always kept
 *   (they belong to no member, so there's nothing to untick). Selecting every
 *   member is equivalent to the whole sprint.
 * Only members that own a scoped task are carried; a `parentId` pointing outside
 * the scoped set is dropped (reads as a top-level task).
 */
export function buildSnapshot(
  project: Project,
  sprint: Sprint,
  members: Member[],
  tasks: Task[],
  opts: { memberId?: string | null; memberIds?: string[] | null } = {}
): SnapshotData {
  const sprintTasks = tasks.filter((t) => t.sprintId === sprint.id)
  const scoped = (() => {
    if (opts.memberIds != null) {
      const keep = new Set(opts.memberIds)
      return sprintTasks.filter((t) => !t.assigneeId || keep.has(t.assigneeId))
    }
    if (opts.memberId != null) return sprintTasks.filter((t) => t.assigneeId === opts.memberId)
    return sprintTasks
  })()

  const ownerIds = new Set(scoped.map((t) => t.assigneeId).filter(Boolean) as string[])
  const usedMembers = members.filter((m) => ownerIds.has(m.id))

  const memberIdx = new Map(usedMembers.map((m, i) => [m.id, i]))
  const taskIdx = new Map(scoped.map((t, i) => [t.id, i]))

  return {
    exportedAt: new Date().toISOString(),
    project: { name: project.name },
    sprint: { name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate ?? null },
    members: usedMembers.map((m, i) => normMember(m, i)),
    tasks: scoped.map((t, i) => normTask(t, i, memberIdx, taskIdx)),
  }
}

/**
 * Flatten one member lane to render rows: top-level tasks ordered by end date
 * (`byEnd`, undated last), each parent's children right under it (also by end),
 * a child whose parent isn't in the lane reads as top-level. Shared by the
 * snapshot board and the sender preview so both nest + order identically. Pure.
 */
export function laneRows(tasks: Task[]): { task: Task; child: boolean }[] {
  const idSet = new Set(tasks.map((t) => t.id))
  const kidsByParent = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.parentId && idSet.has(t.parentId)) {
      const arr = kidsByParent.get(t.parentId) ?? []
      arr.push(t)
      kidsByParent.set(t.parentId, arr)
    }
  }
  const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
  const rows: { task: Task; child: boolean }[] = []
  for (const t of tasks.filter((x) => !isChild(x)).sort(byEnd)) {
    rows.push({ task: t, child: false })
    for (const k of (kidsByParent.get(t.id) ?? []).slice().sort(byEnd)) rows.push({ task: k, child: true })
  }
  return rows
}

/** The compact columnar wire shape (v2). Short keys; arrays are column-parallel. */
interface PackedSnapshot {
  v: 2
  ts: string
  pj: string
  sn: string
  d0: string
  d1: string | null
  mb: [string, string, string][] // [name, color, avatarEmoji|'']
  ti: string[]
  ss: number[] // status enum index
  pp: number[] // priority enum index
  am: number[] // assignee member index, -1 = unassigned
  pa: number[] // parent task index, -1 = top-level
  ef: (number | null)[] // estimate; null = unset, 0 = milestone
  s0: (number | null)[] // start day-offset from d0
  s1: (number | null)[] // end/due day-offset from d0
}

/** Normalized snapshot → compact columnar object (ready for JSON + lz-string). */
function packSnapshot(d: SnapshotData): PackedSnapshot {
  const base = d.sprint.startDate
  const memberPos = new Map(d.members.map((m, i) => [m.id, i]))
  const taskPos = new Map(d.tasks.map((t, i) => [t.id, i]))
  return {
    v: 2,
    ts: d.exportedAt,
    pj: d.project.name,
    sn: d.sprint.name,
    d0: base,
    d1: d.sprint.endDate,
    mb: d.members.map((m) => [m.name, m.color, m.avatarEmoji ?? '']),
    ti: d.tasks.map((t) => t.title),
    ss: d.tasks.map((t) => Math.max(0, STATUS_CODE.indexOf(t.status))),
    pp: d.tasks.map((t) => Math.max(0, PRIO_CODE.indexOf(t.priority))),
    am: d.tasks.map((t) => (t.assigneeId != null ? memberPos.get(t.assigneeId) ?? -1 : -1)),
    pa: d.tasks.map((t) => (t.parentId != null ? taskPos.get(t.parentId) ?? -1 : -1)),
    ef: d.tasks.map((t) => t.estimate ?? null),
    s0: d.tasks.map((t) => toOffset(base, t.startDate)),
    s1: d.tasks.map((t) => toOffset(base, t.dueDate)),
  }
}

const isArr = (x: unknown): x is unknown[] => Array.isArray(x)

/** Compact columnar object → normalized snapshot; null if the shape is wrong. */
function unpackSnapshot(o: unknown): SnapshotData | null {
  if (!o || typeof o !== 'object') return null
  const p = o as Record<string, unknown>
  if (p.v !== 2) return null
  if (typeof p.pj !== 'string' || typeof p.sn !== 'string' || typeof p.d0 !== 'string') return null
  const cols = [p.ti, p.ss, p.pp, p.am, p.pa, p.ef, p.s0, p.s1]
  if (!isArr(p.mb) || cols.some((c) => !isArr(c))) return null
  const n = (p.ti as unknown[]).length
  if (cols.some((c) => (c as unknown[]).length !== n)) return null

  const mb = p.mb as unknown[]
  const members: Member[] = mb.map((row, i) => {
    const r = (isArr(row) ? row : []) as unknown[]
    return {
      id: `m${i}`,
      projectId: '',
      name: String(r[0] ?? ''),
      color: String(r[1] ?? '#8e8e93'),
      daysOff: [],
      avatarEmoji: r[2] ? String(r[2]) : undefined,
    }
  })

  const d0 = p.d0 as string
  const ti = p.ti as unknown[]
  const ss = p.ss as number[]
  const pp = p.pp as number[]
  const am = p.am as number[]
  const pa = p.pa as number[]
  const ef = p.ef as (number | null)[]
  const s0 = p.s0 as (number | null)[]
  const s1 = p.s1 as (number | null)[]

  const tasks: Task[] = ti.map((title, i) => ({
    id: `t${i}`,
    projectId: '',
    sprintId: '',
    createdAt: 0,
    dependsOn: [],
    sequence: i,
    title: String(title ?? ''),
    status: STATUS_CODE[ss[i]] ?? 'todo',
    priority: PRIO_CODE[pp[i]] ?? 'normal',
    estimate: ef[i] == null ? null : Number(ef[i]),
    startDate: fromOffset(d0, s0[i]),
    dueDate: fromOffset(d0, s1[i]),
    assigneeId: typeof am[i] === 'number' && am[i] >= 0 && am[i] < members.length ? `m${am[i]}` : null,
    parentId: typeof pa[i] === 'number' && pa[i] >= 0 && pa[i] < n ? `t${pa[i]}` : null,
  }))

  return {
    exportedAt: typeof p.ts === 'string' ? p.ts : '',
    project: { name: p.pj as string },
    sprint: { name: p.sn as string, startDate: d0, endDate: p.d1 == null ? null : String(p.d1) },
    members,
    tasks,
  }
}

/** Pack + compress a snapshot to a URL-safe blob (goes verbatim after `s=`). */
export function encodeSnapshot(data: SnapshotData): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(packSnapshot(data)))
}

/**
 * Decompress + validate a blob back into a `SnapshotData`. Returns `null` on
 * anything wrong (too long, corrupt, wrong shape) instead of throwing — the viewer
 * renders an "invalid link" state. Content is only ever rendered as React text
 * (auto-escaped), never eval'd, so a hostile payload can't XSS.
 */
export function decodeSnapshot(blob: string): SnapshotData | null {
  if (!blob || blob.length > MAX_BLOB_LEN) return null
  let json: string | null
  try {
    json = LZString.decompressFromEncodedURIComponent(blob)
  } catch {
    return null
  }
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  return unpackSnapshot(data)
}

/** The full share URL: origin+path + `#v=<n>&s=<blob>`. Low-level — the `version`
 * must match the blob's own format, so prefer the paired helpers below
 * (`buildSprintShareUrl` / `buildCollectionShareUrl`) which bind encode+version
 * together and can't drift. */
export function buildShareUrl(blob: string, base?: string, version: number = SNAPSHOT_VERSION): string {
  const root =
    base ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '')
  return `${root}#v=${version}&s=${blob}`
}

/** Encode a sprint snapshot and wrap it in its `v=2` URL — encode+version can't
 * drift. Use this instead of `buildShareUrl(encodeSnapshot(…))`. */
export function buildSprintShareUrl(data: SnapshotData, base?: string): string {
  return buildShareUrl(encodeSnapshot(data), base, SNAPSHOT_VERSION)
}

/** Encode a collection snapshot and wrap it in its `v=3` URL — encode+version
 * can't drift. Use this instead of `buildShareUrl(encodeCollectionSnapshot(…))`. */
export function buildCollectionShareUrl(data: CollectionSnapshotData, base?: string): string {
  return buildShareUrl(encodeCollectionSnapshot(data), base, COLLECTION_SNAPSHOT_VERSION)
}

/**
 * Pull the snapshot blob out of a `#v=2&s=…` hash (leading `#` optional), or
 * `null` if absent / wrong version. Parsed BY HAND, not via `URLSearchParams`:
 * the lz-string blob can contain `+`, which `URLSearchParams` would turn into a
 * space and corrupt the payload.
 */
export function parseShareHash(hash: string): { version: number; blob: string } | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  let v: string | null = null
  let s: string | null = null
  for (const part of h.split('&')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i)
    const val = part.slice(i + 1)
    if (key === 'v') v = val
    else if (key === 's') s = val
  }
  const version = v == null ? NaN : Number(v)
  if (!KNOWN_VERSIONS.has(version) || !s || !s.length) return null
  return { version, blob: s }
}

// ──────────────────────────────────────────────────────────────────────────
// Collection snapshots (v3). A collection groups by SECTION (no members), uses
// user-defined statuses (each with a colour), and items carry only a date range
// (no time / effort / priority). Different enough from the sprint format to get
// its own version rather than overloading v2.
// ──────────────────────────────────────────────────────────────────────────

/** The normalized collection snapshot both sender and viewer speak. Section /
 * status ids are synthetic indices (`s0…` / `x0…`); items reference them. */
export interface CollectionSnapshotData {
  exportedAt: string
  project: { name: string }
  collection: { name: string }
  sections: { id: string; name: string; color?: string }[]
  statuses: { id: string; name: string; color: string }[]
  items: {
    title: string
    startDate: string | null
    dueDate: string | null
    sectionId: string | null
    statusId: string | null
  }[]
}

/**
 * Build a collection snapshot from IN-MEMORY app data. `sectionIds` (optional)
 * keeps only items in those sections (the modal's untick-to-trim). The full
 * status set is carried (so the viewer's legend is complete); only sections that
 * own a scoped item are carried. Items are ordered by section then listOrder.
 */
export function buildCollectionSnapshot(
  project: Project,
  collection: Collection,
  items: Task[],
  opts: { sectionIds?: string[] | null } = {}
): CollectionSnapshotData {
  const collItems = items.filter((t) => t.collectionId === collection.id)
  const scoped =
    opts.sectionIds != null
      ? (() => {
          const keep = new Set(opts.sectionIds)
          return collItems.filter((t) => t.sectionId != null && keep.has(t.sectionId))
        })()
      : collItems

  const usedSectionIds = new Set(scoped.map((t) => t.sectionId).filter(Boolean) as string[])
  const usedSections = collection.sections.filter((s) => usedSectionIds.has(s.id))
  const sectionIdx = new Map(usedSections.map((s, i) => [s.id, i]))
  const statusIdx = new Map(collection.statuses.map((s, i) => [s.id, i]))

  // Stable order: by section (collection order), then listOrder ?? sequence.
  const ordered = [...scoped].sort((a, b) => {
    const sa = a.sectionId != null ? sectionIdx.get(a.sectionId) ?? 999 : 999
    const sb = b.sectionId != null ? sectionIdx.get(b.sectionId) ?? 999 : 999
    if (sa !== sb) return sa - sb
    return (a.listOrder ?? a.sequence) - (b.listOrder ?? b.sequence)
  })

  return {
    exportedAt: new Date().toISOString(),
    project: { name: project.name },
    collection: { name: collection.name },
    sections: usedSections.map((s, i) => ({ id: `s${i}`, name: s.name, color: s.color })),
    statuses: collection.statuses.map((s, i) => ({ id: `x${i}`, name: s.name, color: s.color })),
    items: ordered.map((t) => ({
      title: t.title,
      startDate: t.startDate ? t.startDate.slice(0, 10) : null,
      dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null,
      sectionId: t.sectionId != null && sectionIdx.has(t.sectionId) ? `s${sectionIdx.get(t.sectionId)}` : null,
      statusId:
        t.collectionStatusId != null && statusIdx.has(t.collectionStatusId)
          ? `x${statusIdx.get(t.collectionStatusId)}`
          : null,
    })),
  }
}

/** Compact columnar wire shape (v3). */
interface PackedCollection {
  v: 3
  ts: string
  pj: string
  cn: string
  se: [string, string][] // [section name, color|'']
  st: [string, string][] // [status name, color]
  ti: string[]
  sc: number[] // section index, -1 = none
  xi: number[] // status index, -1 = none
  a0: (string | null)[] // start yyyy-mm-dd (absolute)
  a1: (string | null)[] // due yyyy-mm-dd (absolute)
}

function packCollection(d: CollectionSnapshotData): PackedCollection {
  const secPos = new Map(d.sections.map((s, i) => [s.id, i]))
  const stPos = new Map(d.statuses.map((s, i) => [s.id, i]))
  return {
    v: 3,
    ts: d.exportedAt,
    pj: d.project.name,
    cn: d.collection.name,
    se: d.sections.map((s) => [s.name, s.color ?? '']),
    st: d.statuses.map((s) => [s.name, s.color]),
    ti: d.items.map((t) => t.title),
    sc: d.items.map((t) => (t.sectionId != null ? secPos.get(t.sectionId) ?? -1 : -1)),
    xi: d.items.map((t) => (t.statusId != null ? stPos.get(t.statusId) ?? -1 : -1)),
    a0: d.items.map((t) => t.startDate),
    a1: d.items.map((t) => t.dueDate),
  }
}

/** Compact columnar object → normalized collection snapshot; null if shape wrong. */
function unpackCollection(o: unknown): CollectionSnapshotData | null {
  if (!o || typeof o !== 'object') return null
  const p = o as Record<string, unknown>
  if (p.v !== 3) return null
  if (typeof p.pj !== 'string' || typeof p.cn !== 'string') return null
  const cols = [p.ti, p.sc, p.xi, p.a0, p.a1]
  if (!isArr(p.se) || !isArr(p.st) || cols.some((c) => !isArr(c))) return null
  const n = (p.ti as unknown[]).length
  if (cols.some((c) => (c as unknown[]).length !== n)) return null

  const sections = (p.se as unknown[]).map((row, i) => {
    const r = (isArr(row) ? row : []) as unknown[]
    return { id: `s${i}`, name: String(r[0] ?? ''), color: r[1] ? String(r[1]) : undefined }
  })
  const statuses = (p.st as unknown[]).map((row, i) => {
    const r = (isArr(row) ? row : []) as unknown[]
    return { id: `x${i}`, name: String(r[0] ?? ''), color: String(r[1] ?? '#8e8e93') }
  })
  const sc = p.sc as number[]
  const xi = p.xi as number[]
  const a0 = p.a0 as (string | null)[]
  const a1 = p.a1 as (string | null)[]
  const items = (p.ti as unknown[]).map((title, i) => ({
    title: String(title ?? ''),
    startDate: a0[i] != null ? String(a0[i]) : null,
    dueDate: a1[i] != null ? String(a1[i]) : null,
    sectionId: typeof sc[i] === 'number' && sc[i] >= 0 && sc[i] < sections.length ? `s${sc[i]}` : null,
    statusId: typeof xi[i] === 'number' && xi[i] >= 0 && xi[i] < statuses.length ? `x${xi[i]}` : null,
  }))
  return {
    exportedAt: typeof p.ts === 'string' ? p.ts : '',
    project: { name: p.pj as string },
    collection: { name: p.cn as string },
    sections,
    statuses,
    items,
  }
}

/** Pack + compress a collection snapshot to a URL-safe blob. */
export function encodeCollectionSnapshot(data: CollectionSnapshotData): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(packCollection(data)))
}

/** Decompress + validate a v3 blob back into a `CollectionSnapshotData`, or null. */
export function decodeCollectionSnapshot(blob: string): CollectionSnapshotData | null {
  if (!blob || blob.length > MAX_BLOB_LEN) return null
  let json: string | null
  try {
    json = LZString.decompressFromEncodedURIComponent(blob)
  } catch {
    return null
  }
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  return unpackCollection(data)
}
