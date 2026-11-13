import type Dexie from 'dexie'
import type { Transaction } from 'dexie'

// Own tiny storage wrapper: importing lib.ts would close an import cycle
// (lib → scheduling → schema → sync-stamp).
const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* storage full or unavailable */
    }
  },
}

/**
 * Folder sync bookkeeping (design-docs/folder-sync.md): every local write
 * stamps `modifiedAt`, every local delete leaves a tombstone, so two devices
 * merging their snapshots can tell which side changed a record last.
 *
 * Done with Dexie hooks so no call site has to remember it. The sync merge
 * marks its own transaction (`markSyncTx`) and the hooks leave it alone —
 * records copied from the other device keep their original `modifiedAt`.
 */

/** Every table that syncs. Order = the order a merge applies them in. */
export const SYNC_TABLES = [
  'projects',
  'people',
  'members',
  'sprints',
  'collections',
  'tasks',
  'events',
  'shares',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

const TOMBSTONES_KEY = 'plan-up:syncTombstones'
/** Tombstones older than this are dropped — both devices have long synced by then. */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000

export type Tombstones = Record<string, number>
export const tombKey = (table: string, id: string) => `${table}:${id}`

// ---- clock ----------------------------------------------------------------

let last = 0
/** Wall-clock ms that never repeats or goes backwards within this app run, so a
 * delete and a re-create in the same millisecond still order correctly. */
export function stampNow(): number {
  const t = Date.now()
  last = t > last ? t : last + 1
  return last
}

// ---- tombstones -----------------------------------------------------------

function readMap(key: string): Tombstones {
  try {
    const raw = safeStorage.get(key)
    const v = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? (v as Tombstones) : {}
  } catch {
    return {}
  }
}

export function getTombstones(): Tombstones {
  return readMap(TOMBSTONES_KEY)
}

export function setTombstones(t: Tombstones): void {
  safeStorage.set(TOMBSTONES_KEY, JSON.stringify(t))
}

/** Add tombstones (keeping the later time per key) and save once. */
export function addTombstones(batch: Tombstones): void {
  const keys = Object.keys(batch)
  if (!keys.length) return
  const all = getTombstones()
  for (const k of keys) all[k] = Math.max(all[k] ?? 0, batch[k])
  setTombstones(all)
}

/** Drop tombstones past the TTL. Returns the pruned map (also saved). */
export function pruneTombstones(now = Date.now()): Tombstones {
  const all = getTombstones()
  let changed = false
  for (const [k, at] of Object.entries(all)) {
    if (now - at > TOMBSTONE_TTL_MS) {
      delete all[k]
      changed = true
    }
  }
  if (changed) setTombstones(all)
  return all
}

// ---- transaction marking ---------------------------------------------------

const SYNC_TX = Symbol('plan-up-sync-tx')

/** Mark a transaction as the sync merge: hooks won't stamp or tombstone inside it. */
export function markSyncTx(tx: Transaction): void {
  ;(tx as unknown as Record<symbol, boolean>)[SYNC_TX] = true
}

function isSyncTx(tx: Transaction | undefined): boolean {
  // A nested db.transaction() gets its own Transaction object whose `parent`
  // is the outer one — walk up so the mark covers nested scopes too.
  let t = tx as (Transaction & { parent?: Transaction }) | undefined
  while (t) {
    if ((t as unknown as Record<symbol, boolean>)[SYNC_TX]) return true
    t = t.parent
  }
  return false
}

// ---- hooks -----------------------------------------------------------------

const pendingByTx = new WeakMap<Transaction, Tombstones>()
function rootTx(tx: Transaction): Transaction {
  let t = tx as Transaction & { parent?: Transaction }
  while (t.parent) t = t.parent
  return t
}

let onLocalChange: (() => void) | null = null
/** sync.ts registers here to hear about local edits (to schedule a sync). */
export function setLocalChangeListener(fn: (() => void) | null): void {
  onLocalChange = fn
}

let installed = false
/** Install the stamping hooks on `db`. Idempotent. */
export function installSyncHooks(db: Dexie): void {
  if (installed) return
  installed = true
  for (const name of SYNC_TABLES) {
    const table = db.table(name)
    table.hook('creating', function (_key, obj, tx) {
      if (isSyncTx(tx)) return
      ;(obj as { modifiedAt?: number }).modifiedAt = stampNow()
      onLocalChange?.()
    })
    table.hook('updating', function (mods, _key, _obj, tx) {
      if (isSyncTx(tx)) return undefined
      // An update that only rewrites modifiedAt itself is not a user edit.
      if (Object.keys(mods).every((k) => k === 'modifiedAt')) return undefined
      onLocalChange?.()
      return { modifiedAt: stampNow() }
    })
    table.hook('deleting', function (key, _obj, tx) {
      if (isSyncTx(tx)) return
      // Collected per transaction in memory and saved once when it commits: a
      // clear() of thousands of rows would otherwise re-serialise the whole map
      // per row. A rolled-back delete never reaches storage.
      const root = rootTx(tx)
      let batch = pendingByTx.get(root)
      if (!batch) {
        batch = {}
        pendingByTx.set(root, batch)
        const b = batch
        root.on('complete', () => addTombstones(b))
      }
      batch[tombKey(name, String(key))] = stampNow()
      onLocalChange?.()
    })
  }
}
