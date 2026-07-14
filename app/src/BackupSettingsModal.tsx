import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import {
  BACKUP_KEEP,
  VERSIONS_KEEP,
  getBackupDir,
  getLastBackupStatus,
  isBackupEnabled,
  setBackupDir,
  setBackupEnabled,
  type BackupStatus,
} from './backup'
import { pickBackupDir, runBackupNow } from './backup-tauri'

/**
 * Auto-backup settings (desktop only) — design-docs/auto-backup.md. State
 * lives in localStorage (plan-up:backup*); this modal is just a thin editor
 * over it plus a manual "Back up now" trigger.
 */

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ts).toLocaleDateString()
}

export function BackupSettingsModal({ onClose }: { onClose: () => void }) {
  const [enabled, setEnabled] = useState(isBackupEnabled)
  const [dir, setDir] = useState(getBackupDir)
  const [last, setLast] = useState<BackupStatus | null>(getLastBackupStatus)
  const [running, setRunning] = useState(false)

  // The 30s auto-backup can fire while the modal sits open — keep the status
  // line live by re-reading the persisted status.
  useEffect(() => {
    const t = setInterval(() => setLast(getLastBackupStatus()), 2000)
    return () => clearInterval(t)
  }, [])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    setBackupEnabled(next)
  }

  const chooseFolder = async () => {
    const picked = await pickBackupDir()
    if (!picked) return
    setBackupDir(picked)
    setDir(picked)
    // Picking a folder when none was set is an obvious "turn it on".
    if (!enabled) {
      setEnabled(true)
      setBackupEnabled(true)
    }
  }

  const backupNow = async () => {
    setRunning(true)
    try {
      setLast(await runBackupNow())
    } finally {
      setRunning(false)
    }
  }

  return (
    <ModalSheet title="Auto backup" onClose={onClose}>
      <p className="text-[13px] text-ink-muted leading-snug">
        Writes a full backup to a folder 30 s after any change: a daily
        <span className="tabular-nums"> plan-up-YYYY-MM-DD.json</span> (newest {BACKUP_KEEP} kept)
        plus an immutable copy in <span className="tabular-nums">versions/</span> (newest{' '}
        {VERSIONS_KEEP} kept) so a bad edit never overwrites your last good state.
      </p>

      <div className="flex items-center justify-between">
        <button
          onClick={toggle}
          className="text-[13.5px] font-medium text-ink text-left cursor-pointer"
        >
          Back up automatically
        </button>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Back up automatically"
          onClick={toggle}
          className={`relative w-[42px] h-[26px] rounded-full transition-colors ${
            enabled ? 'bg-accent' : 'bg-border-hair'
          }`}
        >
          <span
            className={`absolute top-[3px] w-[20px] h-[20px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] motion-reduce:transition-none ${
              enabled ? 'left-[19px]' : 'left-[3px]'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex-1 min-w-0 truncate text-[13px] tabular-nums ${dir ? 'text-ink' : 'text-ink-faint'}`}
          title={dir ?? undefined}
        >
          {dir ?? 'No folder chosen'}
        </span>
        <button
          onClick={chooseFolder}
          className="shrink-0 text-xs flex items-center gap-1.5 px-2.5 py-1.5 text-accent hover:bg-accent-soft rounded-[8px] transition"
        >
          <FolderOpen size={13} /> Choose folder…
        </button>
      </div>

      {enabled && !dir && (
        <p className="text-[12px] text-warn-ink leading-snug">
          Choose a folder to start backing up — nothing is written until one is set.
        </p>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border-hair">
        <span className="text-[12px] leading-snug min-w-0 pr-3" role="status" aria-live="polite">
          {last ? (
            last.ok ? (
              <span className="text-status-done">
                Last backup {timeAgo(last.at)} → {last.file}
              </span>
            ) : (
              <span className="text-overdue break-words">
                Backup failed: {last.error} — try re-picking the folder.
              </span>
            )
          ) : (
            <span className="text-ink-faint">No backup yet.</span>
          )}
        </span>
        <button
          onClick={backupNow}
          disabled={running || !dir}
          className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-[8px] bg-accent text-white hover:bg-accent-hover transition disabled:opacity-40 inline-flex items-center gap-2"
        >
          {running && (
            <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
          )}
          Back up now
        </button>
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={onClose}
          className="px-3.5 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-hover rounded-[8px] transition"
        >
          Done
        </button>
      </div>
    </ModalSheet>
  )
}
