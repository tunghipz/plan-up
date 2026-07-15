import { useMemo, useState } from 'react'
import { Link2, Check, Copy, AlertTriangle, ExternalLink, Rows3 } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import {
  buildCollectionShareUrl,
  SHARE_MAX_BYTES,
  type CollectionSnapshotData,
} from './share-snapshot'

/**
 * Turn a collection into a read-only share link (v3 snapshot in the URL
 * fragment, no server). The trim unit is the SECTION (collections have no
 * members/assignees): a checklist lets the sender untick a table to leave it
 * out. Mirrors ShareLinkModal's shell/idiom. See design-docs/share-link-snapshot.md.
 */

/** Middle-ellipsis so the long lz blob reads as a tidy link (copy uses the full URL). */
function truncateMiddle(s: string, head = 30, tail = 8): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`
}

export function CollectionShareModal({
  subtitle,
  sections,
  counts,
  statusColors,
  buildBundle,
  onClose,
}: {
  subtitle: string
  /** Sections that own at least one item (checklist rows). */
  sections: { id: string; name: string; color?: string }[]
  /** Item count per section id (for the row's count). */
  counts: Record<string, number>
  /** The collection's status colours, for the summary legend dots. */
  statusColors: string[]
  /** Builds the snapshot for the given selected section ids. */
  buildBundle: (sectionIds: string[]) => CollectionSnapshotData
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sections.map((s) => s.id)))
  const [copied, setCopied] = useState(false)

  const { bundle, url, bytes } = useMemo(() => {
    const bundle = buildBundle([...selected])
    const url = buildCollectionShareUrl(bundle)
    return { bundle, url, bytes: url.length }
  }, [buildBundle, selected])

  const empty = bundle.items.length === 0
  const over = bytes > SHARE_MAX_BYTES

  const allOn = selected.size === sections.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(sections.map((s) => s.id)))

  const doCopy = async () => {
    if (empty) return
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* give up silently — the field is still selectable */
      }
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <ModalSheet title="Share link" onClose={onClose}>
      <div className="-mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
        <Link2 size={14} strokeWidth={1.9} className="text-accent" aria-hidden />
        {subtitle}
      </div>

      {/* Summary — collection · items · sections + status legend dots. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-fill rounded-[10px] px-3 py-2 text-[12.5px]">
        <span className="font-semibold text-ink">{bundle.collection.name}</span>
        <span className="text-ink-muted">
          · {bundle.items.length} item{bundle.items.length === 1 ? '' : 's'} · {bundle.sections.length} section
          {bundle.sections.length === 1 ? '' : 's'}
        </span>
        {statusColors.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            {statusColors.slice(0, 6).map((c, i) => (
              <span key={i} className="w-[9px] h-[9px] rounded-[3px]" style={{ background: c }} aria-hidden />
            ))}
          </span>
        )}
      </div>

      {/* Sections — whole collection by default; untick to leave a table out. */}
      {sections.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12px] text-ink-faint">Sections trong link</span>
            <button onClick={toggleAll} className="text-[12px] font-semibold text-accent hover:underline">
              {allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          </div>
          <div className="rounded-[11px] border border-border overflow-hidden max-h-[214px] overflow-y-auto">
            {sections.map((s, i) => {
              const on = selected.has(s.id)
              return (
                <button
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-fill ${
                    i > 0 ? 'border-t border-border-hair' : ''
                  } ${on ? '' : 'opacity-50'}`}
                >
                  <span
                    className={`w-[19px] h-[19px] rounded-[6px] grid place-items-center shrink-0 border transition ${
                      on ? 'bg-accent border-accent' : 'border-border-strong'
                    }`}
                  >
                    {on && <Check size={12} strokeWidth={3} className="text-white" />}
                  </span>
                  <span
                    className="w-[22px] h-[22px] rounded-[7px] grid place-items-center shrink-0"
                    style={{ background: s.color || 'var(--color-ink-faint)' }}
                  >
                    <Rows3 size={12} strokeWidth={2.4} className="text-white opacity-90" aria-hidden />
                  </span>
                  <span className="flex-1 truncate text-[13.5px] font-semibold text-ink">{s.name}</span>
                  <span className="tab-data text-[12px] text-ink-faint">
                    <b className="text-ink-muted font-semibold">{counts[s.id] ?? 0}</b> item
                    {(counts[s.id] ?? 0) === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* The link. Read-only, middle-truncated; copy uses the full URL. */}
      <div>
        <div className="mb-1.5 text-[12px] text-ink-faint">Link</div>
        <div
          onClick={() => !empty && navigator.clipboard?.writeText(url).catch(() => {})}
          title={url}
          className="w-full rounded-[10px] bg-fill border border-border px-3 py-2 text-[12px] font-mono text-ink-muted truncate cursor-pointer"
        >
          {empty ? '—' : truncateMiddle(url)}
        </div>
      </div>

      {/* No size readout — the link works well beyond the browser's limit; we only
          warn when it's big enough that a chat app (Telegram/Zalo) might truncate. */}
      {empty ? (
        <div className="flex items-start gap-2.5 rounded-[11px] bg-fill border border-border px-3.5 py-3 text-[12.5px] text-ink-muted">
          <AlertTriangle size={16} strokeWidth={2} className="text-ink-faint shrink-0 mt-0.5" aria-hidden />
          <span>Chọn ít nhất 1 section để tạo link.</span>
        </div>
      ) : (
        over && (
          <div className="flex items-start gap-2.5 rounded-[11px] bg-accent-soft border border-accent/25 px-3.5 py-3 text-[12.5px] text-ink">
            <AlertTriangle size={16} strokeWidth={2} className="text-accent shrink-0 mt-0.5" aria-hidden />
            <span>
              Collection lớn — link vượt ngưỡng, một số chat (Telegram/Zalo) có thể cắt cụt. Bỏ tick section nặng để
              thu nhỏ. Vẫn copy được nếu muốn thử.
            </span>
          </div>
        )
      )}

      {/* Footer: Open (preview the read-only link in a new tab) + Copy link. */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => !empty && window.open(url, '_blank', 'noopener,noreferrer')}
          disabled={empty}
          title="Mở link read-only trong tab mới (xem thử như người nhận)"
          className="inline-flex items-center justify-center gap-2 rounded-[11px] bg-fill px-4 py-2.5 text-[14px] font-semibold text-ink transition hover:bg-[rgba(0,0,0,0.09)] active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 dark:hover:bg-white/10"
        >
          <ExternalLink size={15} strokeWidth={2} aria-hidden />
          Open
        </button>
        <button
          onClick={doCopy}
          disabled={empty}
          className={`flex-1 inline-flex items-center justify-center gap-2 rounded-[11px] px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${
            copied ? 'bg-status-done' : 'brand-btn'
          }`}
        >
          {copied ? <Check size={16} strokeWidth={2.4} /> : <Copy size={15} strokeWidth={2} />}
          {copied ? 'Copied' : over ? 'Copy link anyway' : 'Copy link'}
        </button>
      </div>
    </ModalSheet>
  )
}
