import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './schema'
import { importAll, exportAll } from './io'
import {
  mergeSnapshots,
  newer,
  runRound,
  sequenceFixes,
  syncFileName,
  deviceId,
  SYNC_FORMAT,
  type Rec,
  type SyncSnapshot,
  type SyncTransport,
  type Tables,
} from './sync'
import { SYNC_TABLES, getTombstones, setTombstones, tombKey } from './sync-stamp'

// design-docs/folder-sync.md

// The test environment has no localStorage; tombstones and sync settings live there.
// (Node has a `localStorage` global that is undefined without a backing file.)
if (!globalThis.localStorage) {
  const m = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    },
  })
}

const empty = (): Tables => Object.fromEntries(SYNC_TABLES.map((t) => [t, []])) as unknown as Tables
const task = (id: string, modifiedAt: number, extra: Partial<Rec> = {}): Rec => ({
  id,
  modifiedAt,
  title: id,
  ...extra,
})

describe('mergeSnapshots', () => {
  it('later modifiedAt wins, per record', () => {
    const local = { tables: { ...empty(), tasks: [task('a', 10, { title: 'mine' }), task('b', 30)] }, tombstones: {} }
    const remote = { tables: { tasks: [task('a', 20, { title: 'theirs' }), task('b', 25), task('c', 5)] } }
    const res = mergeSnapshots(local, [remote])
    expect(res.puts.tasks?.map((r) => [r.id, r.title])).toEqual([
      ['a', 'theirs'],
      ['c', 'c'],
    ])
    expect(res.deletes.tasks).toBeUndefined()
    expect(res.changes).toBe(2)
  })

  it('a delete after the last edit removes the record; an edit after the delete keeps it', () => {
    const local = { tables: { ...empty(), tasks: [task('a', 10), task('b', 50)] }, tombstones: {} }
    const remote = { tables: {}, tombstones: { [tombKey('tasks', 'a')]: 20, [tombKey('tasks', 'b')]: 40 } }
    const res = mergeSnapshots(local, [remote])
    expect(res.deletes.tasks).toEqual(['a'])
    expect(res.tombstones[tombKey('tasks', 'b')]).toBe(40)
  })

  it('does not resurrect a record this device deleted', () => {
    const local = { tables: empty(), tombstones: { [tombKey('tasks', 'a')]: 30 } }
    const res = mergeSnapshots(local, [{ tables: { tasks: [task('a', 10)] } }])
    expect(res.changes).toBe(0)
  })

  it('ties pick the same side on both devices', () => {
    const x = task('a', 10, { title: 'x' })
    const y = task('a', 10, { title: 'y' })
    expect(newer(x, y)).toBe(!newer(y, x))
    const onA = mergeSnapshots({ tables: { ...empty(), tasks: [x] }, tombstones: {} }, [{ tables: { tasks: [y] } }])
    const onB = mergeSnapshots({ tables: { ...empty(), tasks: [y] }, tombstones: {} }, [{ tables: { tasks: [x] } }])
    const finalA = onA.puts.tasks?.[0] ?? x
    const finalB = onB.puts.tasks?.[0] ?? y
    expect(finalA).toEqual(finalB)
  })
})

describe('sequenceFixes', () => {
  it('keeps the earlier task on a duplicate # and renumbers the rest after the max', () => {
    const fixes = sequenceFixes([
      { id: 'a', sprintId: 'S', sequence: 5, createdAt: 1 },
      { id: 'b', sprintId: 'S', sequence: 5, createdAt: 2 },
      { id: 'c', sprintId: 'S', sequence: 6, createdAt: 3 },
      { id: 'd', sprintId: 'T', sequence: 5, createdAt: 9 },
    ])
    expect(fixes).toEqual([{ id: 'b', sequence: 7 }])
  })
})

// ---- end to end against the real (fake-indexeddb) database --------------------

/** The sync/ folder in memory (gzip is Rust's job, not this module's). */
class MemFolder implements SyncTransport {
  files = new Map<string, string>()
  async list() {
    return [...this.files.keys()]
  }
  async read(name: string) {
    return this.files.get(name)!
  }
  async write(name: string, text: string) {
    this.files.set(name, text)
  }
  put(snap: SyncSnapshot) {
    this.files.set(syncFileName(snap.deviceId), JSON.stringify(snap))
  }
  own(): SyncSnapshot {
    return JSON.parse(this.files.get(syncFileName(deviceId()))!)
  }
}

const otherDevice = (tables: Partial<Tables>, tombstones = {}): SyncSnapshot => ({
  format: SYNC_FORMAT,
  deviceId: 'iphone-test01',
  deviceName: 'iPhone',
  writtenAt: Date.now(),
  schema: db.verno,
  tables: { ...empty(), ...tables },
  tombstones,
})

async function seed() {
  await db.projects.add({ id: 'P', name: 'P', createdAt: 1 } as never)
  await db.sprints.add({ id: 'S', projectId: 'P', name: 'S1', startDate: '2026-11-09', endDate: '2026-11-22' } as never)
  await db.tasks.add({
    id: 't1', projectId: 'P', sprintId: 'S', sequence: 1, title: 'one', assigneeId: null, status: 'todo',
    priority: 'normal', startDate: null, dueDate: null, estimate: null, createdAt: 1, dependsOn: [],
  } as never)
}

describe('sync round', () => {
  beforeEach(async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear()
    setTombstones({})
    localStorage.clear()
  })

  it('stamps local writes and tombstones local deletes', async () => {
    await seed()
    const t = await db.tasks.get('t1')
    expect(typeof t?.modifiedAt).toBe('number')
    const before = t!.modifiedAt!
    await db.tasks.update('t1', { title: 'renamed' })
    expect((await db.tasks.get('t1'))!.modifiedAt).toBeGreaterThan(before)
    await db.tasks.delete('t1')
    expect(getTombstones()[tombKey('tasks', 't1')]).toBeGreaterThan(before)
  })

  it('pulls a newer edit, applies a remote delete, writes our own file', async () => {
    await seed()
    const folder = new MemFolder()
    const mine = (await db.tasks.get('t1'))!
    folder.put(
      otherDevice(
        {
          tasks: [{ ...(mine as unknown as Rec), title: 'from phone', modifiedAt: mine.modifiedAt! + 1000 }],
          sprints: [],
        },
        { [tombKey('sprints', 'S')]: Date.now() + 1000 }
      )
    )
    const status = await runRound(folder)
    expect(status.ok).toBe(true)
    expect(status.devices?.map((d) => d.name)).toEqual(['iPhone'])
    expect((await db.tasks.get('t1'))!.title).toBe('from phone')
    // the remote copy kept its own modifiedAt (the hooks left the merge alone)
    expect((await db.tasks.get('t1'))!.modifiedAt).toBe(mine.modifiedAt! + 1000)
    expect(await db.sprints.get('S')).toBeUndefined()
    const own = folder.own()
    expect(own.tables.tasks[0].title).toBe('from phone')
    expect(own.tombstones[tombKey('sprints', 'S')]).toBeDefined()
  })

  it('a full import replaces everywhere: old rows get tombstones, new rows newer stamps', async () => {
    await seed()
    const backup = await exportAll()
    await db.tasks.add({ ...(await db.tasks.get('t1'))!, id: 't2', sequence: 2 })
    await importAll(backup)
    const tombs = getTombstones()
    expect(tombs[tombKey('tasks', 't2')]).toBeDefined()
    const t1 = (await db.tasks.get('t1'))!
    expect(t1.modifiedAt!).toBeGreaterThan(tombs[tombKey('tasks', 't1')] ?? 0)
    // merging the pre-import state from another device does not undo the import
    const folder = new MemFolder()
    folder.put(otherDevice({ tasks: [{ ...(t1 as unknown as Rec), id: 't2', modifiedAt: 1 }] }))
    await runRound(folder)
    expect(await db.tasks.get('t2')).toBeUndefined()
  })

  it('renumbers a duplicate # created on two devices', async () => {
    await seed()
    const t1 = (await db.tasks.get('t1'))!
    await db.tasks.add({ ...t1, id: 'mac2', sequence: 2, createdAt: 10 })
    const folder = new MemFolder()
    folder.put(otherDevice({ tasks: [{ ...(t1 as unknown as Rec), id: 'phone2', sequence: 2, createdAt: 20, modifiedAt: Date.now() }] }))
    await runRound(folder)
    expect((await db.tasks.get('mac2'))!.sequence).toBe(2)
    expect((await db.tasks.get('phone2'))!.sequence).toBe(3)
  })

  it('skips the write when nothing changed since the last one', async () => {
    await seed()
    const folder = new MemFolder()
    await runRound(folder)
    const first = folder.own().writtenAt
    await new Promise((r) => setTimeout(r, 5))
    await runRound(folder)
    expect(folder.own().writtenAt).toBe(first)
  })
})
