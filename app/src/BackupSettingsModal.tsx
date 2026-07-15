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
import { useConfirm } from './confirm-context'
import { pickBackupDir, runBackupNow, listVersions, readVersion, restoreVersion, type VersionEntry } from './backup-tauri'
import type { ExportPayload } from './io'

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

function fmtVersionTime(d: Date): string {
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function dayLabel(d: Date): string {
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return 'Hôm nay'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function PreviewStat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-[19px] font-bold tabular-nums leading-none">{n}</div>
      <div className="text-[11px] text-ink-muted mt-1">{label}</div>
    </div>
  )
}

/**
 * Restore-from-version section (design-docs/restore-versions.md, Variant A).
 * Lists versions/ snapshots (timestamps only — no read), expands a preview
 * inline on select, and restores the whole DB via restoreVersion() then reloads.
 * Rendered only when a backup dir is set (desktop).
 */
function RestoreSection() {
  const confirm = useConfirm()
  const [entries, setEntries] = useState<VersionEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<ExportPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listVersions()
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])

  const pick = async (file: string) => {
    setSelected(file)
    setPreview(null)
    setErr(null)
    setBusy(true)
    try {
      setPreview(await readVersion(file))
    } catch (e) {
      setErr(`Không đọc được version: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (file: string, at: Date) => {
    const ok = await confirm({
      title: 'Thay toàn bộ dữ liệu?',
      message: `Khôi phục về ${fmtVersionTime(at)} sẽ thay toàn bộ dữ liệu hiện tại bằng bản đó. State hiện tại được tự backup vào versions/ trước — restore nhầm vẫn quay lại được.`,
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setBusy(true)
    setErr(null)
    try {
      await restoreVersion(file)
      location.reload()
    } catch (e) {
      setErr(`Restore thất bại: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <div className="pt-2 border-t border-border-hair space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] font-medium text-ink">Restore từ version</span>
        <span className="text-[11.5px] text-ink-faint">{VERSIONS_KEEP} bản gần nhất</span>
      </div>

      {entries === null ? (
        <p className="text-[12px] text-ink-faint">Đang tải…</p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-ink-faint leading-snug">
          Chưa có version nào. Bản đầu tiên được ghi sau thay đổi dữ liệu đầu tiên.
        </p>
      ) : (
        <div className="max-h-[220px] overflow-auto -mx-1.5 px-1.5 flex flex-col gap-0.5">
          {entries.map((e, i) => {
            const showDay = i === 0 || dayLabel(entries[i - 1].at) !== dayLabel(e.at)
            const sel = e.file === selected
            return (
              <div key={e.file}>
                {showDay && (
                  <div className="px-2.5 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {dayLabel(e.at)}
                  </div>
                )}
                <button
                  onClick={() => pick(e.file)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-left transition ${
                    sel ? 'bg-accent-tint' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${sel ? 'bg-accent' : 'bg-border-strong'}`}
                  />
                  <span className="flex-1 min-w-0 text-[13px] tabular-nums truncate">
                    {fmtVersionTime(e.at)}
                  </span>
                </button>
                {sel && (
                  <div className="mt-1 mb-1 bg-surface border border-border-hair rounded-[12px] p-3">
                    {busy && !preview ? (
                      <p className="text-[12px] text-ink-faint">Đang đọc…</p>
                    ) : preview ? (
                      <>
                        <div className="mb-2.5 text-[11px] text-ink-faint tabular-nums truncate">
                          {e.file}
                        </div>
                        <div className="flex gap-4">
                          <PreviewStat n={preview.projects?.length ?? 0} label="project" />
                          <PreviewStat n={preview.sprints.length} label="sprint" />
                          <PreviewStat n={preview.tasks.length} label="task" />
                        </div>
                        <div className="flex justify-end pt-3">
                          <button
                            onClick={() => restore(e.file, e.at)}
                            disabled={busy}
                            className="text-xs font-semibold px-3 py-1.5 rounded-[8px] bg-accent text-white hover:bg-accent-hover transition disabled:opacity-40 inline-flex items-center gap-2"
                          >
                            {busy && (
                              <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            )}
                            Restore bản này
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {err && <p className="text-[12px] text-overdue leading-snug break-words">{err}</p>}
    </div>
  )
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

      {dir && <RestoreSection />}

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
