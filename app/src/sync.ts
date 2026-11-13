import { db } from './schema'
import { IS_NATIVE_MOBILE, IS_TAURI } from './platform'
import {
  SYNC_TABLES,
  type SyncTable,
  addTombstones,
  type Tombstones,
  markSyncTx,
  pruneTombstones,
  setLocalChangeListener,
  setTombstones,
  tombKey,
} from './sync-stamp'

/**
 * Folder sync between the Mac app and the iPhone app (design-docs/folder-sync.md).
 *
 * Each device writes ONE file of its own into `<folder>/sync/` holding its whole
 * database; a sync round reads the other devices' files, merges them record by
 * record (last modifiedAt wins, a later delete wins), applies the result in a
 * transaction the stamping hooks ignore, then rewrites its own file.
 */

// ---- types -------------------------------------------------------------------

export type Rec = { id: string; modifiedAt?: number; [k: string]: unknown }
export type Tables = Record<SyncTable, Rec[]>

export interface SyncSnapshot {
  format: 1
  deviceId: string
  deviceName: string
  writtenAt: number
  schema: number
  tables: Tables
  tombstones: Tombstones
}

export interface SyncDevice {
  id: string
  name: string
  writtenAt: number
}

export interface SyncStatus {
  at: number
  ok: boolean
  error?: string
  devices?: SyncDevice[]
}

/** Reads and writes the files in `<folder>/sync/` — one per platform. */
export interface SyncTransport {
  list(): Promise<string[]>
  read(name: string): Promise<string>
  write(name: string, text: string): Promise<void>
}

export const SYNC_FORMAT = 1

// ---- pure merge (tested in sync.test.ts) ------------------------------------

const mt = (r: Rec) => (typeof r.modifiedAt === 'number' ? r.modifiedAt : 0)

/** Does `a` beat `b`? Later modifiedAt wins; a tie is broken by the JSON text so
 * both devices pick the same side. */
export function newer(a: Rec, b: Rec): boolean {
  const ma = mt(a)
  const mb = mt(b)
  if (ma !== mb) return ma > mb
  return JSON.stringify(a) > JSON.stringify(b)
}

export interface MergeResult {
  puts: Partial<Record<SyncTable, Rec[]>>
  deletes: Partial<Record<SyncTable, string[]>>
  tombstones: Tombstones
  changes: number
}

/**
 * Merge the local database with other devices' snapshots. Returns only what
 * must change locally: records to put (a remote version won) and ids to delete
 * (a tombstone is newer than the record), plus the combined tombstones.
 */
export function mergeSnapshots(
  local: { tables: Tables; tombstones: Tombstones },
  remotes: { tables: Partial<Tables>; tombstones?: Tombstones }[],
): MergeResult {
  const tombstones: Tombstones = { ...local.tombstones }
  for (const r of remotes) {
    for (const [k, at] of Object.entries(r.tombstones ?? {})) {
      if (typeof at === 'number' && at > (tombstones[k] ?? 0)) tombstones[k] = at
    }
  }
  const puts: MergeResult['puts'] = {}
  const deletes: MergeResult['deletes'] = {}
  let changes = 0
  for (const table of SYNC_TABLES) {
    const localById = new Map<string, Rec>()
    for (const rec of local.tables[table] ?? []) localById.set(rec.id, rec)
    const winner = new Map<string, Rec>(localById)
    for (const remote of remotes) {
      for (const rec of remote.tables[table] ?? []) {
        if (!rec || typeof rec.id !== 'string') continue
        const cur = winner.get(rec.id)
        if (!cur || newer(rec, cur)) winner.set(rec.id, rec)
      }
    }
    const tPuts: Rec[] = []
    const tDels: string[] = []
    for (const [id, rec] of winner) {
      const dead = tombstones[tombKey(table, id)]
      const had = localById.get(id)
      if (dead !== undefined && dead >= mt(rec)) {
        if (had) tDels.push(id)
        continue
      }
      if (rec !== had) tPuts.push(rec)
    }
    if (tPuts.length) puts[table] = tPuts
    if (tDels.length) deletes[table] = tDels
    changes += tPuts.length + tDels.length
  }
  return { puts, deletes, tombstones, changes }
}

/**
 * Two devices can each add a task to the same sprint before syncing and both
 * hand out the next `#`. After a merge the earlier-created task keeps the number
 * and the others move to fresh numbers after the sprint's max — deterministic,
 * so both devices make the same fix (prereqs point at ids, not numbers).
 */
export function sequenceFixes(tasks: Rec[]): { id: string; sequence: number }[] {
  const bySprint = new Map<string, Rec[]>()
  for (const t of tasks) {
    const s = t.sprintId
    if (typeof s !== 'string' || typeof t.sequence !== 'number') continue
    const arr = bySprint.get(s)
    if (arr) arr.push(t)
    else bySprint.set(s, [t])
  }
  const fixes: { id: string; sequence: number }[] = []
  for (const list of bySprint.values()) {
    let max = Math.max(...list.map((t) => t.sequence as number))
    const seen = new Map<number, Rec[]>()
    for (const t of list) {
      const arr = seen.get(t.sequence as number)
      if (arr) arr.push(t)
      else seen.set(t.sequence as number, [t])
    }
    const dupGroups = [...seen.entries()]
      .filter(([, g]) => g.length > 1)
      .sort((a, b) => a[0] - b[0])
    for (const [, group] of dupGroups) {
      group.sort(
        (a, b) =>
          ((a.createdAt as number) ?? 0) - ((b.createdAt as number) ?? 0) ||
          a.id.localeCompare(b.id),
      )
      for (const t of group.slice(1)) fixes.push({ id: t.id, sequence: ++max })
    }
  }
  return fixes
}

// ---- settings -----------------------------------------------------------------

const ENABLED_KEY = 'plan-up:syncEnabled'
const DEVICE_KEY = 'plan-up:syncDeviceId'
const STATUS_KEY = 'plan-up:syncStatus'
const HASH_KEY = 'plan-up:syncLastHash'

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    /* unavailable */
  }
}

/** Only the Mac app and the iPhone app have a folder to sync through. */
export const SYNC_SUPPORTED = IS_TAURI || IS_NATIVE_MOBILE

export function isSyncEnabled(): boolean {
  return SYNC_SUPPORTED && ls(ENABLED_KEY) === '1'
}

export const deviceName = (): string => (IS_NATIVE_MOBILE ? 'iPhone' : 'Mac')

export function deviceId(): string {
  let id = ls(DEVICE_KEY)
  if (!id || !/^[a-z0-9-]{4,40}$/.test(id)) {
    const rand = Array.from(
      { length: 6 },
      () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)],
    ).join('')
    id = `${IS_NATIVE_MOBILE ? 'iphone' : 'mac'}-${rand}`
    lsSet(DEVICE_KEY, id)
  }
  return id
}

export const syncFileName = (id: string) => `plan-up-sync-${id}.json.gz`
const idFromFileName = (name: string) =>
  name.replace(/^plan-up-sync-/, '').replace(/\.json\.gz$/, '')

export function getSyncStatus(): SyncStatus | null {
  try {
    const raw = ls(STATUS_KEY)
    return raw ? (JSON.parse(raw) as SyncStatus) : null
  } catch {
    return null
  }
}
function setSyncStatus(s: SyncStatus): SyncStatus {
  lsSet(STATUS_KEY, JSON.stringify(s))
  for (const fn of statusListeners) fn(s)
  return s
}
const statusListeners = new Set<(s: SyncStatus) => void>()
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}

// ---- transport ----------------------------------------------------------------

let transportFactory: (() => Promise<SyncTransport | null>) | null = null
/** backup-tauri.ts (Mac) / backup-folder-mobile.ts (iPhone) register the transport. */
export function setSyncTransportFactory(f: () => Promise<SyncTransport | null>): void {
  transportFactory = f
}
async function transport(): Promise<SyncTransport> {
  const t = transportFactory ? await transportFactory() : null
  if (!t) throw new Error(IS_NATIVE_MOBILE ? 'Chưa chọn folder.' : 'Chưa chọn folder backup.')
  return t
}

// ---- local snapshot -------------------------------------------------------------

async function readLocalTables(): Promise<Tables> {
  const out = {} as Tables
  for (const t of SYNC_TABLES) out[t] = (await db.table(t).toArray()) as Rec[]
  return out
}

function hashText(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${s.length}:${h >>> 0}`
}

async function writeOwn(tr: SyncTransport, force = false): Promise<void> {
  const tables = await readLocalTables()
  const tombstones = pruneTombstones()
  const body = JSON.stringify({ tables, tombstones })
  const hash = hashText(body)
  if (!force && ls(HASH_KEY) === hash) return // nothing changed since our last write
  const id = deviceId()
  const snap: SyncSnapshot = {
    format: SYNC_FORMAT,
    deviceId: id,
    deviceName: deviceName(),
    writtenAt: Date.now(),
    schema: db.verno,
    tables,
    tombstones,
  }
  await tr.write(syncFileName(id), JSON.stringify(snap))
  lsSet(HASH_KEY, hash)
}

/** Other devices' snapshots in the folder (bad / foreign files skipped). */
async function readOthers(
  tr: SyncTransport,
): Promise<{ snaps: SyncSnapshot[]; problems: string[] }> {
  const me = deviceId()
  const names = (await tr.list()).filter((n) => idFromFileName(n) !== me)
  const snaps: SyncSnapshot[] = []
  const problems: string[] = []
  for (const name of names) {
    try {
      const s = JSON.parse(await tr.read(name)) as SyncSnapshot
      if (s?.format !== SYNC_FORMAT || !s.tables) {
        problems.push(`${name}: định dạng không hỗ trợ`)
        continue
      }
      if (s.schema > db.verno) {
        problems.push(`${s.deviceName} dùng bản app mới hơn — cập nhật app trên máy này`)
        continue
      }
      snaps.push(s)
    } catch (e) {
      problems.push(`${name}: ${String(e)}`)
    }
  }
  return { snaps, problems }
}

const deviceList = (snaps: SyncSnapshot[]): SyncDevice[] =>
  snaps.map((s) => ({
    id: s.deviceId,
    name: s.deviceName,
    writtenAt: s.writtenAt,
  }))

// ---- one round ---------------------------------------------------------------------

let running: Promise<SyncStatus> | null = null

/** Run one sync round now (or join the one already running). Never throws. */
export function syncNow(): Promise<SyncStatus> {
  if (!isSyncEnabled())
    return Promise.resolve({
      at: Date.now(),
      ok: false,
      error: 'Đồng bộ đang tắt.',
    })
  running ??= (async () => {
    try {
      return setSyncStatus(await runRound(await transport()))
    } catch (e) {
      return setSyncStatus({ at: Date.now(), ok: false, error: String(e) })
    } finally {
      running = null
    }
  })()
  return running
}

/** One round against a transport: merge the others in, write ours. Throws on
 * transport failure (syncNow turns that into a status). Exported for tests. */
export async function runRound(tr: SyncTransport): Promise<SyncStatus> {
  const { snaps, problems } = await readOthers(tr)
  if (snaps.length) {
    const local = {
      tables: await readLocalTables(),
      tombstones: pruneTombstones(),
    }
    const res = mergeSnapshots(local, snaps)
    if (res.changes) await applyMerge(res)
    // Max-merge, not replace: a local delete that committed while we were
    // merging must keep its tombstone.
    addTombstones(res.tombstones)
    const fixes = sequenceFixes((await db.tasks.toArray()) as unknown as Rec[])
    for (const f of fixes) await db.tasks.update(f.id, { sequence: f.sequence })
  }
  await writeOwn(tr)
  return {
    at: Date.now(),
    ok: problems.length === 0,
    error: problems.length ? problems.join(' · ') : undefined,
    devices: deviceList(snaps),
  }
}

async function applyMerge(res: MergeResult): Promise<void> {
  await db.transaction('rw', [...SYNC_TABLES], async (tx) => {
    markSyncTx(tx)
    for (const t of SYNC_TABLES) {
      const dels = res.deletes[t]
      if (dels?.length) await db.table(t).bulkDelete(dels)
      const puts = res.puts[t]
      if (puts?.length) await db.table(t).bulkPut(puts)
    }
  })
}

// ---- turning it on ---------------------------------------------------------------

/** What the folder already holds from other devices — the UI asks before adopting. */
export async function peekOtherDevices(): Promise<SyncDevice[]> {
  const tr = await transport()
  const { snaps } = await readOthers(tr)
  return deviceList(snaps).sort((a, b) => b.writtenAt - a.writtenAt)
}

/**
 * Turn sync on. With `adoptFrom` (the newest other device), first replace this
 * device's data with that device's snapshot — the first round can't merge, the
 * old rows have no modifiedAt — after `saveSafetyCopy` stored the current data.
 */
export async function enableSync(opts: {
  adoptFrom?: string
  saveSafetyCopy?: () => Promise<void>
}): Promise<SyncStatus> {
  const tr = await transport()
  if (opts.adoptFrom) {
    const name = syncFileName(opts.adoptFrom)
    const snap = JSON.parse(await tr.read(name)) as SyncSnapshot
    if (snap?.format !== SYNC_FORMAT || !snap.tables) throw new Error('File đồng bộ không hợp lệ.')
    if (snap.schema > db.verno)
      throw new Error(`${snap.deviceName} dùng bản app mới hơn — cập nhật app trước.`)
    await opts.saveSafetyCopy?.()
    await db.transaction('rw', [...SYNC_TABLES], async (tx) => {
      markSyncTx(tx)
      for (const t of SYNC_TABLES) await db.table(t).clear()
      for (const t of SYNC_TABLES) {
        const rows = snap.tables[t] ?? []
        if (rows.length) await db.table(t).bulkAdd(rows)
      }
    })
    setTombstones({ ...(snap.tombstones ?? {}) })
  }
  lsSet(ENABLED_KEY, '1')
  lsSet(HASH_KEY, null)
  return syncNow()
}

export function disableSync(): void {
  lsSet(ENABLED_KEY, null)
}

// ---- schedule ---------------------------------------------------------------------

const AFTER_EDIT_MS = 5000
const EVERY_MS = 60_000

/**
 * Keep syncing while the app runs: shortly after start, 5 s after the last
 * local edit, every 60 s, and when the app comes back to the foreground.
 * Returns a disposer (App mounts it once).
 */
export function startSync(): () => void {
  if (!SYNC_SUPPORTED) return () => {}
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = (ms: number) => {
    if (!isSyncEnabled()) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void syncNow()
    }, ms)
  }
  setLocalChangeListener(() => schedule(AFTER_EDIT_MS))
  const every = setInterval(() => {
    if (document.visibilityState === 'visible') schedule(0)
  }, EVERY_MS)
  const onVis = () => {
    if (document.visibilityState === 'visible') schedule(300)
  }
  document.addEventListener('visibilitychange', onVis)
  schedule(1500)
  return () => {
    setLocalChangeListener(null)
    clearInterval(every)
    document.removeEventListener('visibilitychange', onVis)
    if (timer) clearTimeout(timer)
  }
}
