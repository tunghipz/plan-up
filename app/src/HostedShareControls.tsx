import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import type { ShareRecord } from './types'
import { getShareForRef, saveShareRecord, deleteShareRecord } from './db'
import {
  createShare,
  updateShare,
  revokeShare,
  viewUrl,
  HostedError,
  type ShareKind,
} from './share-hosted'
import { openExternal } from './share-runtime'

/**
 * The lower half of both share modals: turns the current snapshot `blob` into a
 * short, updatable hosted link (`/view/<slug>-<id>`), or falls back to the long
 * in-URL link when offline. Owns the `shares` record (Create / Update / Revoke)
 * and the Copy/Open affordances. See design-docs/hosted-share-link.md.
 */

function truncateMiddle(s: string, head = 34, tail = 10): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    /* give up silently */
  }
  ta.remove()
}

function errMsg(e: unknown): string {
  if (e instanceof HostedError) return `Store trả lỗi (${e.status}). Thử lại hoặc dùng link dài bên dưới.`
  return 'Không kết nối được store — dùng link dài bên dưới để chia sẻ tạm (không update được).'
}

export function HostedShareControls({
  refId,
  projectId,
  kind,
  slug,
  blob,
  empty,
  fallbackUrl,
}: {
  refId: string
  projectId: string
  kind: ShareKind
  slug: string
  /** Current encoded snapshot for the selection. */
  blob: string
  /** Nothing selected → can't create. */
  empty: boolean
  /** The long in-URL link, shown as an offline fallback. */
  fallbackUrl: string
}) {
  // undefined = still loading the local record; null = not shared yet.
  const [record, setRecord] = useState<ShareRecord | null | undefined>(undefined)
  const [busy, setBusy] = useState<'' | 'create' | 'update' | 'revoke'>('')
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [updated, setUpdated] = useState(false)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [fbCopied, setFbCopied] = useState(false)
  // Blob known to be on the server (assume synced at open); drives the dirty hint.
  const [syncedBlob, setSyncedBlob] = useState(blob)

  useEffect(() => {
    let alive = true
    getShareForRef(refId).then((r) => {
      if (!alive) return
      setRecord(r ?? null)
      setSyncedBlob(blob)
    })
    return () => {
      alive = false
    }
    // Reload only when the shared plan changes; blob is intentionally excluded
    // (it changes as the user ticks sections/members — we don't want to reset the
    // record then). syncedBlob is seeded here to "in sync at open".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId])

  const dirty = !!record && blob !== syncedBlob

  async function doCreate() {
    setBusy('create')
    setErr(null)
    try {
      const { id, writeToken } = await createShare(blob, kind)
      const now = Date.now()
      const rec: ShareRecord = {
        id,
        refId,
        kind,
        slug,
        writeToken,
        url: viewUrl(slug, id),
        createdAt: now,
        updatedAt: now,
        projectId,
      }
      await saveShareRecord(rec)
      setRecord(rec)
      setSyncedBlob(blob)
    } catch (e) {
      setErr(errMsg(e))
      setFallbackOpen(true)
    } finally {
      setBusy('')
    }
  }

  async function doUpdate() {
    if (!record) return
    setBusy('update')
    setErr(null)
    try {
      await updateShare(record.id, record.writeToken, blob)
      // Refresh the slug too, so the URL prettifies after a rename (id unchanged).
      const rec: ShareRecord = { ...record, slug, url: viewUrl(slug, record.id), updatedAt: Date.now() }
      await saveShareRecord(rec)
      setRecord(rec)
      setSyncedBlob(blob)
      setUpdated(true)
      window.setTimeout(() => setUpdated(false), 1600)
    } catch (e) {
      // 404 → the link was revoked/expired server-side; forget it locally so the
      // UI drops back to "Create".
      if (e instanceof HostedError && e.status === 404) {
        await deleteShareRecord(record.id)
        setRecord(null)
      } else {
        setErr(errMsg(e))
        setFallbackOpen(true)
      }
    } finally {
      setBusy('')
    }
  }

  async function doRevoke() {
    if (!record) return
    setBusy('revoke')
    setErr(null)
    try {
      await revokeShare(record.id, record.writeToken)
    } catch (e) {
      // Anything but "already gone" leaves the record in place so the user can retry.
      if (!(e instanceof HostedError && e.status === 404)) {
        setErr(errMsg(e))
        setBusy('')
        return
      }
    }
    await deleteShareRecord(record.id)
    setRecord(null)
    setBusy('')
  }

  async function doCopy() {
    if (!record) return
    await copyText(record.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  async function doCopyFallback() {
    await copyText(fallbackUrl)
    setFbCopied(true)
    window.setTimeout(() => setFbCopied(false), 1400)
  }

  const fallbackBlock = (
    <div className="mt-1">
      {!fallbackOpen ? (
        <button
          onClick={() => setFallbackOpen(true)}
          className="text-[12px] text-ink-faint hover:text-ink-muted hover:underline"
        >
          Cần link offline? Dùng link dài (không update được)
        </button>
      ) : (
        <div className="rounded-[11px] border border-border bg-fill px-3 py-2.5">
          <div className="mb-1 text-[12px] text-ink-faint">Link dài (offline — data nằm trong URL, không update được)</div>
          <div
            onClick={doCopyFallback}
            title={fallbackUrl}
            className="w-full rounded-[8px] bg-card border border-border px-2.5 py-1.5 text-[11.5px] font-mono text-ink-muted truncate cursor-pointer"
          >
            {truncateMiddle(fallbackUrl, 40, 10)}
          </div>
          <button
            onClick={doCopyFallback}
            className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent hover:underline"
          >
            {fbCopied ? <Check size={13} strokeWidth={2.4} /> : <Copy size={13} strokeWidth={2} />}
            {fbCopied ? 'Copied' : 'Copy link dài'}
          </button>
        </div>
      )}
    </div>
  )

  // ---- loading ----
  if (record === undefined) {
    return <div className="h-[52px] rounded-[11px] bg-fill animate-pulse" aria-hidden />
  }

  // ---- not shared yet ----
  if (record === null) {
    return (
      <div className="flex flex-col gap-2.5">
        {empty ? (
          <div className="flex items-start gap-2.5 rounded-[11px] bg-fill border border-border px-3.5 py-3 text-[12.5px] text-ink-muted">
            <AlertTriangle size={16} strokeWidth={2} className="text-ink-faint shrink-0 mt-0.5" aria-hidden />
            <span>Chọn ít nhất 1 {kind === 'collection' ? 'section' : 'member'} để tạo link.</span>
          </div>
        ) : (
          <button
            onClick={doCreate}
            disabled={busy !== ''}
            className="w-full inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white brand-btn transition active:scale-[0.98] disabled:opacity-50"
          >
            <Link2 size={15} strokeWidth={2} />
            {busy === 'create' ? 'Đang tạo…' : 'Tạo link chia sẻ'}
          </button>
        )}
        {err && <div className="text-[12px] text-[#ff3b30]">{err}</div>}
        {!empty && fallbackBlock}
      </div>
    )
  }

  // ---- shared ----
  return (
    <div className="flex flex-col gap-2.5">
      {/* Sync hint */}
      <div className="flex items-center gap-2 text-[12px]">
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#c98a12] dark:text-[#e0a83a]">
            <span className="w-[7px] h-[7px] rounded-full bg-[#e0a83a]" /> Link đang giữ bản cũ — bấm Cập nhật
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-status-done">
            <span className="w-[7px] h-[7px] rounded-full bg-status-done" />
            {updated ? 'Đã cập nhật ✓' : 'Link đã đồng bộ'}
          </span>
        )}
      </div>

      {/* The short link */}
      <div
        onClick={doCopy}
        title={record.url}
        className="w-full rounded-[10px] bg-fill border border-border px-3 py-2.5 text-[13px] font-mono text-ink cursor-pointer break-all"
      >
        {truncateMiddle(record.url)}
      </div>

      {err && <div className="text-[12px] text-[#ff3b30]">{err}</div>}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => openExternal(record.url)}
          title="Mở link trong trình duyệt"
          className="inline-flex items-center justify-center gap-1.5 rounded-[11px] bg-fill px-3 py-2.5 text-[13.5px] font-semibold text-ink transition hover:bg-[rgba(0,0,0,0.09)] active:scale-[0.98] dark:hover:bg-white/10"
        >
          <ExternalLink size={15} strokeWidth={2} />
          Open
        </button>
        {dirty && (
          <button
            onClick={doUpdate}
            disabled={busy !== ''}
            title="Đẩy bản mới nhất lên (link không đổi)"
            className="inline-flex items-center justify-center gap-1.5 rounded-[11px] bg-fill px-3 py-2.5 text-[13.5px] font-semibold text-accent transition hover:bg-accent-soft active:scale-[0.98] disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={2} className={busy === 'update' ? 'animate-spin' : ''} />
            {busy === 'update' ? 'Đang cập nhật…' : 'Cập nhật'}
          </button>
        )}
        <button
          onClick={doCopy}
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] ${
            copied ? 'bg-status-done' : 'brand-btn'
          }`}
        >
          {copied ? <Check size={16} strokeWidth={2.4} /> : <Copy size={15} strokeWidth={2} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      <button
        onClick={doRevoke}
        disabled={busy !== ''}
        className="inline-flex items-center gap-1.5 self-start text-[12px] font-semibold text-[#ff3b30] hover:underline disabled:opacity-50"
      >
        <Trash2 size={13} strokeWidth={2} />
        {busy === 'revoke' ? 'Đang thu hồi…' : 'Thu hồi link'}
      </button>
    </div>
  )
}
