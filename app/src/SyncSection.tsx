import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useConfirm } from './confirm-context'
import {
  disableSync,
  enableSync,
  getSyncStatus,
  isSyncEnabled,
  onSyncStatus,
  peekOtherDevices,
  syncNow,
  type SyncStatus,
} from './sync'

/**
 * "Đồng bộ qua folder này" — the sync switch + status, shared by the Mac's Auto
 * backup modal and the iPhone's Folder backup sheet (design-docs/folder-sync.md).
 * Turning it on when the folder already holds another device's snapshot asks
 * first, saves this device's data (`saveSafetyCopy`), then takes the other
 * device's data and reloads.
 */

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

function StatusLine({ status }: { status: SyncStatus | null }) {
  if (!status) return <span className="text-ink-faint">Chưa đồng bộ lần nào.</span>
  if (!status.ok) {
    return <span className="text-overdue break-words">Lỗi đồng bộ: {status.error}</span>
  }
  const others = (status.devices ?? []).map((d) => `${d.name} (${hhmm(d.writtenAt)})`).join(', ')
  return (
    <span className="text-status-done">
      Đồng bộ lúc {hhmm(status.at)}
      {others ? ` · ${others}` : ' · chưa thấy máy khác'}
    </span>
  )
}

export function SyncSection({
  safetyCopyWhere,
  saveSafetyCopy,
}: {
  /** Where the safety copy goes, for the confirm text ("Files › plan-up"). */
  safetyCopyWhere: string
  saveSafetyCopy: () => Promise<void>
}) {
  const confirm = useConfirm()
  const [enabled, setEnabled] = useState(isSyncEnabled)
  const [status, setStatus] = useState<SyncStatus | null>(getSyncStatus)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => onSyncStatus(setStatus), [])

  const turnOn = async () => {
    setBusy(true)
    setErr(null)
    try {
      const others = await peekOtherDevices()
      const from = others[0]
      if (from) {
        const ok = await confirm({
          title: `Lấy dữ liệu từ ${from.name}?`,
          message: `Lần đồng bộ đầu tiên thay toàn bộ dữ liệu trên máy này bằng dữ liệu của ${from.name} (ghi lúc ${hhmm(from.writtenAt)}). Dữ liệu hiện tại được lưu trước vào ${safetyCopyWhere}. Từ sau đó hai máy gộp thay đổi của nhau.`,
          confirmLabel: 'Lấy dữ liệu',
        })
        if (!ok) return
        await enableSync({ adoptFrom: from.id, saveSafetyCopy })
        location.reload()
        return
      }
      await enableSync({})
      setEnabled(isSyncEnabled())
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = () => {
    if (busy) return
    if (enabled) {
      disableSync()
      setEnabled(false)
    } else {
      void turnOn()
    }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      await syncNow()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pt-2 border-t border-border-hair space-y-2">
      <div className="flex items-center justify-between gap-3">
        <button onClick={toggle} className="text-left min-w-0">
          <span className="block text-[13.5px] max-md:text-[15px] font-medium text-ink">
            Đồng bộ qua folder này
          </span>
          <span className="block text-[12px] text-ink-muted leading-snug">
            Mac và iPhone cùng sửa được, gộp thay đổi của nhau.
          </span>
        </button>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Đồng bộ qua folder này"
          disabled={busy}
          onClick={toggle}
          className={`relative shrink-0 w-[42px] h-[26px] rounded-full transition-colors disabled:opacity-50 ${
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
      {enabled && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] leading-snug min-w-0" role="status" aria-live="polite">
            <StatusLine status={status} />
          </span>
          <button
            onClick={runNow}
            disabled={busy}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs max-md:text-[14px] max-md:min-h-9 px-2.5 py-1.5 text-accent hover:bg-accent-soft rounded-[8px] transition disabled:opacity-40"
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Đồng bộ ngay
          </button>
        </div>
      )}
      {err && <p className="text-[12px] text-overdue leading-snug break-words">{err}</p>}
    </div>
  )
}
