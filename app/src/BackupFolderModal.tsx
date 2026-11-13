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
  safetyCopyFilename,
} from './backup-folder-mobile'
import { SyncSection } from './SyncSection'
import { isSyncEnabled } from './sync'
import { exportAll } from './io'
import { saveToNativeFiles } from './native-save'

/**
 * iPhone `⋯ → Folder backup…` (design-docs/ios-backup-folder.md): pick the Mac's
 * auto-backup folder in iCloud Drive once, then sync through it
 * (folder-sync.md — the only write, into `sync/`) and/or open one of its
 * snapshots in place of the phone's data.
 */

const FOLDER_SOURCE: RestoreSource = {
  list: listFolderVersions,
  read: readFolderVersion,
  restore: openFolderVersion,
  actionLabel: 'Mở bản này',
  confirmTitle: 'Thay dữ liệu trên iPhone?',
  confirmMessage: (when) =>
    `Dữ liệu trên iPhone sẽ được thay bằng bản backup lúc ${when}. Dữ liệu hiện tại được lưu trước vào Files › On My iPhone › plan-up, mở nhầm vẫn Import lại được.${
      isSyncEnabled() ? ' Đồng bộ đang bật: Mac cũng sẽ thành bản này.' : ''
    }`,
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
        Folder backup của app Mac trong iCloud Drive. Bật đồng bộ để Mac và iPhone cùng sửa; hoặc mở
        một bản backup thay cho dữ liệu trên iPhone.
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
        <SyncSection
          key={`sync#${pickCount}`}
          safetyCopyWhere="Files › On My iPhone › plan-up"
          saveSafetyCopy={async () => {
            const current = await exportAll()
            await saveToNativeFiles(
              safetyCopyFilename(new Date()),
              { text: JSON.stringify(current) },
              { quiet: true }
            )
          }}
        />
      )}

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
