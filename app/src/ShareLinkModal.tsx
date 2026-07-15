import { useEffect, useMemo, useState } from 'react'
import { Link2, Check } from 'lucide-react'
import { ModalSheet } from './ModalSheet'
import { colorForName } from './schema'
import { getProjectShare } from './db'
import type { Member } from './types'
import { encodeSnapshot, buildSprintShareUrl, type SnapshotData } from './share-snapshot'
import { slugify } from './share-hosted'
import { shareBaseUrl } from './share-runtime'
import { HostedShareControls } from './HostedShareControls'

/**
 * Turn a sprint into a read-only share link. The primary link is a short,
 * updatable HOSTED link (`/view/<slug>-<id>`, data on the store); an in-URL
 * fragment link stays available as an offline fallback (via HostedShareControls).
 * A member checklist lets the sender untick people to trim the snapshot. See
 * design-docs/hosted-share-link.md + share-link-snapshot.md.
 */

function Avatar({ member }: { member: Member }) {
  const color = member.color || colorForName(member.name)
  if (member.avatarImage) {
    return <img src={member.avatarImage} alt={member.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
  }
  return (
    <span
      className="w-6 h-6 rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0"
      style={{ background: color }}
    >
      {member.avatarEmoji ?? member.name.charAt(0).toUpperCase()}
    </span>
  )
}

export function ShareLinkModal({
  subtitle,
  refId,
  projectId,
  members,
  counts,
  buildBundle,
  onClose,
}: {
  subtitle: string
  /** The sprint id — key for the local share record. */
  refId: string
  projectId: string
  /** Members that own at least one task in the sprint (checklist rows). */
  members: Member[]
  /** Assignee-only task count per member id (for the row's count). */
  counts: Record<string, number>
  /** Builds the snapshot for the given selected member ids (unassigned always kept). */
  buildBundle: (memberIds: string[]) => SnapshotData
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(members.map((m) => m.id)))

  // The sprint link is PROJECT-scope (one link/project, Hướng A): look it up by project.
  // Only seed the checklist from the stored trim when the link is CURRENTLY showing THIS
  // sprint (`currentRefId === refId`) — re-sharing the live sprint keeps its trim so
  // reopening doesn't reset to "all" (which would falsely read stale + re-broaden scope).
  // Opening a DIFFERENT sprint leaves it at "all" (another sprint's member set won't map).
  useEffect(() => {
    let alive = true
    getProjectShare(projectId, 'sprint')
      .then((rec) => {
        if (!alive || !rec?.selectedIds || rec.currentRefId !== refId) return
        const ids = new Set(members.map((m) => m.id))
        setSelected(new Set(rec.selectedIds.filter((id) => ids.has(id))))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId, projectId])

  const { bundle, blob, sig, fallbackUrl, slug } = useMemo(() => {
    const bundle = buildBundle([...selected])
    return {
      bundle,
      blob: encodeSnapshot(bundle),
      // Content signature for staleness — exportedAt is volatile (rebuilt each
      // render), so exclude it or the link would always look out of date.
      sig: JSON.stringify({ ...bundle, exportedAt: '' }),
      fallbackUrl: buildSprintShareUrl(bundle, shareBaseUrl()),
      // Slug = PROJECT name (the sprint name is the auto/locked "Sprint N", which
      // makes a meaningless link); only the suffix is the store key anyway.
      slug: slugify(bundle.project.name || bundle.sprint.name),
    }
  }, [buildBundle, selected])

  const empty = bundle.tasks.length === 0

  const allOn = selected.size === members.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(members.map((m) => m.id)))

  return (
    <ModalSheet title="Share link" onClose={onClose}>
      <div className="-mt-1 flex items-center gap-2 text-[13px] text-ink-muted">
        <Link2 size={14} strokeWidth={1.9} className="text-accent" aria-hidden />
        {subtitle}
      </div>

      {/* Summary — exactly what this link carries. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 bg-fill rounded-[10px] px-3 py-2 text-[12.5px]">
        <span className="font-semibold text-ink">
          {bundle.sprint.name ? `${bundle.sprint.name} · ` : ''}
          {bundle.project.name}
        </span>
        <span className="text-ink-muted">
          · {bundle.tasks.length} task{bundle.tasks.length === 1 ? '' : 's'} · {bundle.members.length} member
          {bundle.members.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Members — whole sprint by default; untick to leave someone out. */}
      {members.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[12px] text-ink-faint">Members trong link</span>
            <button onClick={toggleAll} className="text-[12px] font-semibold text-accent hover:underline">
              {allOn ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
            </button>
          </div>
          <div className="rounded-[11px] border border-border overflow-hidden max-h-[196px] overflow-y-auto">
            {members.map((m, i) => {
              const on = selected.has(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
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
                  <Avatar member={m} />
                  <span className="flex-1 truncate text-[13.5px] text-ink">{m.name}</span>
                  <span className="tab-data text-[12px] text-ink-faint">
                    <b className="text-ink-muted font-semibold">{counts[m.id] ?? 0}</b> task
                    {(counts[m.id] ?? 0) === 1 ? '' : 's'}
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
        kind="sprint"
        scope="project"
        currentLabel={bundle.sprint.name || 'Sprint'}
        slug={slug}
        blob={blob}
        sig={sig}
        selectedIds={[...selected]}
        empty={empty}
        fallbackUrl={fallbackUrl}
      />
    </ModalSheet>
  )
}
