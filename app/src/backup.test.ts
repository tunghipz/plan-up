import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  backupFilename,
  versionFilename,
  parseVersionFilename,
  selectPrunable,
  selectPrunableVersions,
  hashString,
  BackupScheduler,
} from './backup'

describe('backupFilename', () => {
  it('uses LOCAL date parts, zero-padded', () => {
    // Local components — no UTC shift even at 23:30.
    const d = new Date(2026, 6, 7, 23, 30)
    expect(backupFilename(d)).toBe('plan-up-2026-07-07.json')
  })

  it('pads single-digit month and day', () => {
    expect(backupFilename(new Date(2026, 0, 3))).toBe('plan-up-2026-01-03.json')
  })
})

describe('versionFilename', () => {
  it('appends local HHMMSS, zero-padded', () => {
    expect(versionFilename(new Date(2026, 6, 7, 15, 30, 45))).toBe(
      'plan-up-2026-07-07-153045.json',
    )
  })

  it('pads single-digit time parts and midnight', () => {
    expect(versionFilename(new Date(2026, 0, 3, 1, 2, 5))).toBe('plan-up-2026-01-03-010205.json')
    expect(versionFilename(new Date(2026, 0, 3, 0, 0, 0))).toBe('plan-up-2026-01-03-000000.json')
  })
})

describe('parseVersionFilename', () => {
  it('round-trips versionFilename (local parts)', () => {
    const d = new Date(2026, 6, 7, 15, 30, 45)
    expect(parseVersionFilename(versionFilename(d))).toEqual(d)
  })

  it('parses zero-padded midnight', () => {
    expect(parseVersionFilename('plan-up-1999-12-31-000000.json')).toEqual(
      new Date(1999, 11, 31, 0, 0, 0),
    )
  })

  it('rejects the daily-file shape (no time)', () => {
    expect(parseVersionFilename('plan-up-2026-07-07.json')).toBeNull()
  })

  it('rejects malformed names', () => {
    expect(parseVersionFilename('plan-up-2026-07-07-1530.json')).toBeNull()
    expect(parseVersionFilename('plan-up-2026-07-07_153045.json')).toBeNull()
    expect(parseVersionFilename('other-2026-07-07-153045.json')).toBeNull()
    expect(parseVersionFilename('')).toBeNull()
  })
})

describe('selectPrunableVersions', () => {
  const ver = (n: number) => `plan-up-2026-01-01-1000${String(n).padStart(2, '0')}.json`

  it('drops the oldest beyond keep, newest survive', () => {
    const names = Array.from({ length: 5 }, (_, i) => ver(i + 1))
    expect(selectPrunableVersions(names, 2)).toEqual([ver(3), ver(2), ver(1)])
  })

  it('ignores daily files and other names — only strict version names count', () => {
    const names = ['plan-up-2026-01-01.json', 'notes.txt', ver(1), ver(2)]
    expect(selectPrunableVersions(names, 1)).toEqual([ver(1)])
  })

  it('defaults to keeping 200', () => {
    const names = Array.from({ length: 200 }, (_, i) => ver(i + 1))
    expect(selectPrunableVersions(names)).toEqual([])
  })
})

describe('hashString', () => {
  it('is stable for identical input and differs for changed input', () => {
    expect(hashString('{"a":1}')).toBe(hashString('{"a":1}'))
    expect(hashString('{"a":1}')).not.toBe(hashString('{"a":2}'))
  })
})

describe('selectPrunable', () => {
  const day = (n: number) => `plan-up-2026-01-${String(n).padStart(2, '0')}.json`

  it('returns empty when at or under the keep limit', () => {
    const names = Array.from({ length: 30 }, (_, i) => day(i + 1))
    expect(selectPrunable(names)).toEqual([])
    expect(selectPrunable([])).toEqual([])
  })

  it('drops the oldest files beyond keep, regardless of input order', () => {
    const names = Array.from({ length: 31 }, (_, i) => day(i + 1)).reverse()
    expect(selectPrunable(names)).toEqual([day(1)])
  })

  it('ignores files that are not strict plan-up backups', () => {
    const names = [
      'plan-up-2026-01-01.json',
      'plan-up-2026-1-1.json',
      'plan-up-2026-01-01.json.bak',
      'notes.txt',
      'other-2026-01-01.json',
    ]
    expect(selectPrunable(names, 1)).toEqual([])
    expect(selectPrunable(names, 0)).toEqual(['plan-up-2026-01-01.json'])
  })

  it('honors a custom keep count', () => {
    const names = [day(1), day(2), day(3)]
    expect(selectPrunable(names, 1)).toEqual([day(2), day(1)])
  })
})

describe('BackupScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once on the trailing edge after quiet', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const s = new BackupScheduler(30_000, run)
    s.notify()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('coalesces bursts — each notify re-arms the quiet window', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const s = new BackupScheduler(30_000, run)
    s.notify()
    await vi.advanceTimersByTimeAsync(20_000)
    s.notify() // re-arm
    await vi.advanceTimersByTimeAsync(20_000)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a change during an in-flight run re-arms another run', async () => {
    let resolveRun!: () => void
    const run = vi.fn(() => new Promise<void>((r) => (resolveRun = r)))
    const s = new BackupScheduler(30_000, run)
    s.notify()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
    s.notify() // lands while run #1 is still writing
    resolveRun()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('never fires after dispose', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const s = new BackupScheduler(30_000, run)
    s.notify()
    s.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).not.toHaveBeenCalled()
    s.notify() // notify after dispose is a no-op
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('swallows a rejecting run', async () => {
    const run = vi.fn().mockRejectedValue(new Error('disk gone'))
    const s = new BackupScheduler(1_000, run)
    s.notify()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(1) // and no unhandled rejection
  })

  it('flush runs immediately without waiting out the quiet window', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const s = new BackupScheduler(30_000, run)
    s.notify()
    s.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1) // pending timer was cancelled
  })
})

describe('runBackupNow', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    // Make IS_TAURI true for the re-imported modules.
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@tauri-apps/api/core')
  })

  it('reports "no folder" without touching the DB when unconfigured', async () => {
    const { runBackupNow } = await import('./backup-tauri')
    const status = await runBackupNow()
    expect(status.ok).toBe(false)
    expect(status.error).toMatch(/No backup folder/)
  })

  it('writes both tiers then prunes both, and persists an ok status', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    store.set('plan-up:backupDir', '/tmp/backups')
    const { runBackupNow } = await import('./backup-tauri')
    const status = await runBackupNow()
    expect(status.ok).toBe(true)
    expect(status.file).toMatch(/^plan-up-\d{4}-\d{2}-\d{2}\.json$/)
    // daily write + prune, then version write + prune (first run has no prior hash)
    expect(invoke).toHaveBeenCalledTimes(4)
    // 1. daily rolling file (no subdir)
    expect(invoke.mock.calls[0][0]).toBe('write_backup')
    const daily = invoke.mock.calls[0][1] as {
      dir: string
      fileName: string
      contents: string
      subdir?: string
    }
    expect(daily.dir).toBe('/tmp/backups')
    expect(daily.subdir).toBeUndefined()
    expect(JSON.parse(daily.contents).version).toBe(6)
    expect(invoke.mock.calls[1]).toEqual(['prune_backups', { dir: '/tmp/backups', keep: 30 }])
    // 2. immutable version into versions/ + its own prune (keep 200)
    expect(invoke.mock.calls[2][0]).toBe('write_backup')
    const ver = invoke.mock.calls[2][1] as { fileName: string; subdir: string }
    expect(ver.fileName).toMatch(/^plan-up-\d{4}-\d{2}-\d{2}-\d{6}\.json$/)
    expect(ver.subdir).toBe('versions')
    expect(invoke.mock.calls[3]).toEqual([
      'prune_backups',
      { dir: '/tmp/backups', keep: 200, subdir: 'versions' },
    ])
    expect(JSON.parse(store.get('plan-up:backupLast')!).ok).toBe(true)
    expect(store.get('plan-up:backupHash')).toBeTruthy()
  })

  it('skips the version write when the payload is unchanged (dedup)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    store.set('plan-up:backupDir', '/tmp/backups')
    const { runBackupNow } = await import('./backup-tauri')
    await runBackupNow() // 4 invokes, records the hash
    invoke.mockClear()
    const status = await runBackupNow() // same (empty) DB → hash matches
    expect(status.ok).toBe(true)
    // only the daily tier runs; no version write/prune
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['write_backup', 'prune_backups'])
    expect(invoke.mock.calls.every((c) => (c[1] as { subdir?: string }).subdir === undefined)).toBe(
      true,
    )
  })

  it('catches a failing write into a persisted error status — never throws', async () => {
    const invoke = vi.fn().mockRejectedValue('backup folder not found: /gone')
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
    store.set('plan-up:backupDir', '/gone')
    const { runBackupNow } = await import('./backup-tauri')
    const status = await runBackupNow()
    expect(status.ok).toBe(false)
    expect(status.error).toContain('backup folder not found')
    expect(JSON.parse(store.get('plan-up:backupLast')!).ok).toBe(false)
  })
})
