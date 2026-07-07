import { liveQuery } from 'dexie'
import { db } from './db'
import { exportAll } from './io'
import {
  BACKUP_KEEP,
  BACKUP_QUIET_MS,
  BackupScheduler,
  backupFilename,
  getBackupDir,
  IS_TAURI,
  isBackupEnabled,
  setLastBackupStatus,
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
 * Export the whole DB and write it into the chosen folder, then prune to the
 * newest 30 files. Never throws — every failure lands in the returned (and
 * persisted) status so the settings modal can surface it.
 */
export async function runBackupNow(): Promise<BackupStatus> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) {
    return { at: Date.now(), ok: false, error: 'No backup folder chosen.' }
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const payload = await exportAll()
    const fileName = backupFilename(new Date())
    await invoke('write_backup', { dir, fileName, contents: JSON.stringify(payload) })
    await invoke('prune_backups', { dir, keep: BACKUP_KEEP })
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
