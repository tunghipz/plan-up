import LZString from 'lz-string'
import type { Member, Priority, Project, Sprint, Status, Task } from './types'
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

/** Conservative safe budget for the whole share URL (bytes). Chat apps truncate
 * long links well before the browser's own ~32 KB ceiling — warn past this. */
export const SHARE_MAX_BYTES = 8000

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

/** The full share URL: origin+path + `#v=<n>&s=<blob>`. */
export function buildShareUrl(blob: string, base?: string): string {
  const root =
    base ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '')
  return `${root}#v=${SNAPSHOT_VERSION}&s=${blob}`
}

/**
 * Pull the snapshot blob out of a `#v=2&s=…` hash (leading `#` optional), or
 * `null` if absent / wrong version. Parsed BY HAND, not via `URLSearchParams`:
 * the lz-string blob can contain `+`, which `URLSearchParams` would turn into a
 * space and corrupt the payload.
 */
export function parseShareHash(hash: string): string | null {
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
  if (v !== String(SNAPSHOT_VERSION)) return null
  return s && s.length ? s : null
}
