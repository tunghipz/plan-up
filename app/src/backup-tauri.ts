import { liveQuery } from 'dexie'
import { db } from './db'
import { exportAll, importAll, type ExportPayload } from './io'
import {
  BACKUP_KEEP,
  BACKUP_QUIET_MS,
  BackupScheduler,
  backupFilename,
  getBackupDir,
  getLastBackupHash,
  hashString,
  IS_TAURI,
  isBackupEnabled,
  parseVersionFilename,
  setLastBackupHash,
  setLastBackupStatus,
  versionFilename,
  VERSIONS_DIR,
  VERSIONS_KEEP,
  type BackupStatus,
} from './backup'

/**
 * Auto backup — Tauri glue (design-docs/auto-backup.md). All @tauri-apps/*
 * imports are dynamic so none of this reaches the web bundle's critical path;
 * every entry point no-ops outside the desktop shell.
 */

/** Native directory picker. Returns the chosen path, or null if dismissed. */
export async function pickBackupDir(): Promise<string | null> {
  if (!IS_TAURI) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({ directory: true, title: 'Choose backup folder' })
  return typeof picked === 'string' ? picked : null
}

/**
 * Export the whole DB and back it up in two tiers (design-docs/auto-backup.md):
 *   1. the daily rolling file (overwritten in place), pruned to the newest 30;
 *   2. unless the payload is unchanged since the last snapshot (content dedup),
 *      an immutable `versions/plan-up-…-HHMMSS.json`, pruned to the newest 200.
 * Never throws — every failure lands in the returned (and persisted) status so
 * the settings modal can surface it.
 */
export async function runBackupNow(): Promise<BackupStatus> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) {
    return { at: Date.now(), ok: false, error: 'No backup folder chosen.' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const now = new Date()
    const payload = await exportAll()
    const contents = JSON.stringify(payload)

    // 1. Daily rolling file — overwrite the same-day file, prune to 30 days.
    const fileName = backupFilename(now)
    await invoke('write_backup', { dir, fileName, contents })
    await invoke('prune_backups', { dir, keep: BACKUP_KEEP })

    // 2. Immutable version — dedup on the payload with `exportedAt` neutralised
    // (that field changes every export, so hashing raw contents never matches).
    const hash = hashString(JSON.stringify({ ...payload, exportedAt: '' }))
    if (hash !== getLastBackupHash()) {
      await invoke('write_backup', {
        dir,
        fileName: versionFilename(now),
        contents,
        subdir: VERSIONS_DIR,
      })
      await invoke('prune_backups', { dir, keep: VERSIONS_KEEP, subdir: VERSIONS_DIR })
      setLastBackupHash(hash)
    }

    const status: BackupStatus = { at: Date.now(), ok: true, file: fileName }
    setLastBackupStatus(status)
    return status
  } catch (e) {
    const status: BackupStatus = { at: Date.now(), ok: false, error: String(e) }
    setLastBackupStatus(status)
    return status
  }
}

/**
 * Start the change-driven scheduler: any write to any table re-emits the
 * liveQuery below (count() subscribes to the whole key range — the same
 * invalidation machinery the useLiveQuery views ride), which arms a 30 s
 * trailing debounce. The first emission (fired on subscribe) is skipped.
 * Returns a disposer for the mount effect (StrictMode-safe).
 */
export function startAutoBackup(): () => void {
  if (!IS_TAURI) return () => {}
  const scheduler = new BackupScheduler(BACKUP_QUIET_MS, async () => {
    // Re-checked at fire time so toggling off mid-debounce cancels the run.
    if (!isBackupEnabled() || !getBackupDir()) return
    await runBackupNow()
  })
  let first = true
  const sub = liveQuery(() =>
    Promise.all([
      db.projects.count(),
      db.members.count(),
      db.sprints.count(),
      db.collections.count(),
      db.tasks.count(),
      db.events.count(),
      db.people.count(),
    ]),
  ).subscribe({
    next: () => {
      if (first) {
        first = false
        return
      }
      scheduler.notify()
    },
    error: () => {},
  })
  return () => {
    sub.unsubscribe()
    scheduler.dispose()
  }
}

/** A restorable snapshot in `versions/` — the file name and its parsed local time. */
export interface VersionEntry {
  file: string
  at: Date
}

/**
 * List the immutable `versions/` snapshots, newest first. Off-desktop or with no
 * backup folder set there is nothing to list, so returns []. Names that don't
 * parse as version files are dropped (the folder only ever holds our own writes,
 * but be defensive).
 */
export async function listVersions(): Promise<VersionEntry[]> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) return []
  const { invoke } = await import('@tauri-apps/api/core')
  const names = await invoke<string[]>('list_backups', { dir, subdir: VERSIONS_DIR })
  return names
    .map((file) => ({ file, at: parseVersionFilename(file) }))
    .filter((e): e is VersionEntry => e.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Read + parse one `versions/` snapshot. Throws if unreadable or not JSON. */
export async function readVersion(file: string): Promise<ExportPayload> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) throw new Error('No backup folder chosen.')
  const { invoke } = await import('@tauri-apps/api/core')
  const contents = await invoke<string>('read_backup', { dir, fileName: file, subdir: VERSIONS_DIR })
  return JSON.parse(contents) as ExportPayload
}

/**
 * Restore the whole DB to a chosen snapshot. Fail-safe order: snapshot the
 * CURRENT state first (so a mistaken restore is itself undoable) and abort if
 * that write fails — never destroy without a fresh net. Then read the target and
 * hand it to importAll (which validates before clearing and rolls back on error).
 * The caller reloads the app on success.
 */
export async function restoreVersion(file: string): Promise<void> {
  const snap = await runBackupNow()
  if (!snap.ok) {
    throw new Error(`Could not back up current data first: ${snap.error ?? 'unknown error'}`)
  }
  const payload = await readVersion(file)
  await importAll(payload)
}
