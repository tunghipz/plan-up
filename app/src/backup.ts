import { safeStorage } from './lib'

/**
 * Auto backup — pure logic (design-docs/auto-backup.md). Everything here runs
 * in both web and desktop builds and imports no Tauri code; the Tauri glue
 * (dialog, invoke, liveQuery wiring) lives in backup-tauri.ts.
 */

/** True when running inside the Tauri (desktop) shell. */
export const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const BACKUP_DIR_KEY = 'plan-up:backupDir'
export const BACKUP_ENABLED_KEY = 'plan-up:backupEnabled'
export const BACKUP_LAST_KEY = 'plan-up:backupLast'

export const BACKUP_KEEP = 30
export const BACKUP_QUIET_MS = 30_000

export interface BackupStatus {
  at: number
  ok: boolean
  file?: string
  error?: string
}

export function getBackupDir(): string | null {
  return safeStorage.get(BACKUP_DIR_KEY)
}

export function isBackupEnabled(): boolean {
  return safeStorage.get(BACKUP_ENABLED_KEY) === '1'
}

export function setBackupEnabled(on: boolean): void {
  safeStorage.set(BACKUP_ENABLED_KEY, on ? '1' : '0')
}

export function setBackupDir(dir: string): void {
  safeStorage.set(BACKUP_DIR_KEY, dir)
}

export function getLastBackupStatus(): BackupStatus | null {
  const raw = safeStorage.get(BACKUP_LAST_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as BackupStatus
  } catch {
    return null
  }
}

export function setLastBackupStatus(status: BackupStatus): void {
  safeStorage.set(BACKUP_LAST_KEY, JSON.stringify(status))
}

/**
 * Today's backup filename, from LOCAL date parts — "today's file" should follow
 * the user's clock. (The manual export slices the UTC `exportedAt` instead;
 * deliberate difference, recorded in auto-backup.md.)
 */
export function backupFilename(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `plan-up-${y}-${m}-${day}.json`
}

const BACKUP_NAME_RE = /^plan-up-\d{4}-\d{2}-\d{2}\.json$/

/**
 * Which files retention should delete: strict `plan-up-YYYY-MM-DD.json` matches
 * only, newest `keep` survive. Name == date, so lexicographic order is
 * chronological. Mirrors the Rust `prune_backups` — kept here as its executable
 * spec (backup.test.ts).
 */
export function selectPrunable(names: string[], keep = BACKUP_KEEP): string[] {
  return names
    .filter((n) => BACKUP_NAME_RE.test(n))
    .sort((a, b) => b.localeCompare(a))
    .slice(keep)
}

/**
 * Trailing-edge debounce driving the backup run: every `notify()` (re)arms a
 * `quietMs` timer; changes landing while a run is in flight re-arm it so the
 * final state always gets written. `notify()` never throws; `dispose()` cancels
 * whatever is pending.
 */
export class BackupScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private rearm = false
  private disposed = false
  private quietMs: number
  private run: () => Promise<void>

  constructor(quietMs: number, run: () => Promise<void>) {
    this.quietMs = quietMs
    this.run = run
  }

  notify(): void {
    if (this.disposed) return
    if (this.running) {
      this.rearm = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.fire(), this.quietMs)
  }

  /** Run now (still coalesces with an in-flight run). Used by "Back up now". */
  flush(): void {
    if (this.disposed) return
    if (this.running) {
      this.rearm = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    void this.fire()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire(): Promise<void> {
    this.timer = null
    this.running = true
    try {
      await this.run()
    } catch {
      /* run() is expected to swallow its own errors; never propagate */
    } finally {
      this.running = false
      if (this.rearm && !this.disposed) {
        this.rearm = false
        this.notify()
      }
    }
  }
}
