import type { Status } from './types'
import { STATUS_META } from './sprint-logic'

/**
 * Read-only status pill — the SAME soft-tint formula the sprint List uses
 * (`SprintView`'s group StatusPill): `color-mix(status 15%)` background,
 * `color-mix(status 78%, ink)` text, a solid status dot. Driven by `STATUS_META`
 * (single source of the status → CSS-var mapping) so the tint can't drift from
 * the List. Used by the share-link surfaces (SnapshotViewer board + ShareLinkModal
 * preview). See design-docs/share-link-snapshot.md.
 */
export function StatusPill({ status, dot = true }: { status: Status; dot?: boolean }) {
  const v = STATUS_META[status].varName // e.g. 'var(--color-status-progress)'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] font-semibold leading-none whitespace-nowrap"
      style={{
        background: `color-mix(in srgb, ${v} 15%, transparent)`,
        color: `color-mix(in srgb, ${v} 78%, var(--color-ink))`,
      }}
    >
      {dot && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v }} />
      )}
      {STATUS_META[status].label}
    </span>
  )
}
