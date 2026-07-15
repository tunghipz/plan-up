import { useMemo, useState } from 'react'
import { Link2, Check, Rows3 } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import {
  encodeCollectionSnapshot,
  buildCollectionShareUrl,
  type CollectionSnapshotData,
} from './share-snapshot'
import { slugify } from './share-hosted'
import { shareBaseUrl } from './share-runtime'
import { HostedShareControls } from './HostedShareControls'

/**
 * Turn a collection into a read-only share link. Primary = short updatable HOSTED
 * link (`/view/<slug>-<id>`); in-URL fragment link stays as an offline fallback
 * (via HostedShareControls). The trim unit is the SECTION (collections have no
 * members): a checklist lets the sender untick a table to leave it out. See
 * design-docs/hosted-share-link.md + share-link-snapshot.md.
 */
export function CollectionShareModal({
  subtitle,
  refId,
  projectId,
  sections,
  counts,
  statusColors,
  buildBundle,
  onClose,
}: {
  subtitle: string
  /** The collection id — key for the local share record. */
  refId: string
  projectId: string
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

  const { bundle, blob, fallbackUrl, slug } = useMemo(() => {
    const bundle = buildBundle([...selected])
    return {
      bundle,
      blob: encodeCollectionSnapshot(bundle),
      fallbackUrl: buildCollectionShareUrl(bundle, shareBaseUrl()),
      slug: slugify(bundle.collection.name),
    }
  }, [buildBundle, selected])

  const empty = bundle.items.length === 0

  const allOn = selected.size === sections.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(sections.map((s) => s.id)))

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
          <div className="rounded-[11px] border border-border overflow-hidden max-h-[196px] overflow-y-auto">
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

      {/* Hosted link (short, updatable) + offline fallback. */}
      <HostedShareControls
        refId={refId}
        projectId={projectId}
        kind="collection"
        slug={slug}
        blob={blob}
        empty={empty}
        fallbackUrl={fallbackUrl}
      />
    </ModalSheet>
  )
}
