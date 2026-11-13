import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import { RestoreSection, type RestoreSource } from './BackupSettingsModal'
import {
  getFolderName,
  listFolderVersions,
  openFolderVersion,
  pickFolder,
  readFolderVersion,
} from './backup-folder-mobile'

/**
 * iPhone `⋯ → Folder backup…` (design-docs/ios-backup-folder.md): pick the Mac's
 * auto-backup folder in iCloud Drive once, then open its newest snapshot (or an
 * older one) in place of the phone's data. Read-only on the folder.
 */

const FOLDER_SOURCE: RestoreSource = {
  list: listFolderVersions,
  read: readFolderVersion,
  restore: openFolderVersion,
  actionLabel: 'Mở bản này',
  confirmTitle: 'Thay dữ liệu trên iPhone?',
  confirmMessage: (when) =>
    `Dữ liệu trên iPhone sẽ được thay bằng bản backup lúc ${when}. Dữ liệu hiện tại được lưu trước vào Files › On My iPhone › plan-up, mở nhầm vẫn Import lại được.`,
  confirmLabel: 'Mở',
  emptyText: 'Folder này chưa có versions/. Chọn folder auto backup của bản Mac.',
}

export function BackupFolderModal({ onClose }: { onClose: () => void }) {
  // undefined = still asking native; null = none chosen.
  const [name, setName] = useState<string | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  // Bumped on every pick so the list reloads even when the same folder is re-picked.
  const [pickCount, setPickCount] = useState(0)

  useEffect(() => {
    getFolderName()
      .then(setName)
      .catch((e) => {
        setName(null)
        setErr(`Không mở được folder đã chọn: ${String(e)}. Chọn lại folder.`)
      })
  }, [])

  const choose = async () => {
    setErr(null)
    try {
      const picked = await pickFolder()
      if (!picked) return
      setName(picked)
      setPickCount((n) => n + 1)
    } catch (e) {
      setErr(`Không chọn được folder: ${String(e)}`)
    }
  }

  return (
    <ModalSheet title="Folder backup" onClose={onClose}>
      <p className="text-[13px] text-ink-muted leading-snug">
        Mở bản backup mà app Mac tự ghi vào iCloud Drive. Chỉ đọc, app không ghi gì vào folder.
      </p>

      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`flex-1 min-w-0 truncate text-[14px] ${name ? 'text-ink' : 'text-ink-faint'}`}
        >
          {name === undefined ? 'Đang tải…' : (name ?? 'Chưa chọn folder')}
        </span>
        <button
          onClick={choose}
          className="shrink-0 min-h-11 text-[15px] flex items-center gap-1.5 px-3 text-accent active:bg-accent-soft rounded-[8px] transition"
        >
          <FolderOpen size={16} /> Chọn folder…
        </button>
      </div>

      {err && <p className="text-[12px] text-overdue leading-snug break-words">{err}</p>}

      {name && (
        <RestoreSection
          key={`${name}#${pickCount}`}
          title="Các bản backup"
          source={FOLDER_SOURCE}
          preselectFirst
        />
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={onClose}
          className="min-h-11 px-4 text-[15px] font-medium text-ink-muted active:bg-surface-hover rounded-[8px] transition"
        >
          Xong
        </button>
      </div>
    </ModalSheet>
  )
}
