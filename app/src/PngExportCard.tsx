import { forwardRef } from 'react'
import type { Status } from './types'
import { STATUS_LABEL, fmtDays } from './lib'
import { colorForName } from './schema'
import type { WorkingPlan } from './scheduling'
import type { MemberGroup } from './png-export'

/**
 * The off-screen card that becomes the exported PNG (design-docs/export-png.md).
 * Deliberately styled with INLINE HEX — no Tailwind classes, CSS vars or
 * `oklch()` — so `modern-screenshot` renders it identically regardless of the
 * app's cascade/theme. Always the light palette: shareable images must be
 * predictable and readable on a chat background.
 */

// Light palette — hard-coded to match the light `--color-*` tokens in index.css.
const C = {
  ink: '#1d1d1f',
  muted: '#6e6e73',
  faint: '#a1a1a6',
  hair: '#e5e5ea',
  surface: '#ffffff',
  panel: '#f5f5f7',
  accent: '#0071e3',
  overdue: '#ff3b30',
  statusTodo: '#8e8e93',
  statusProgress: '#0071e3',
  statusDone: '#34c759',
}

const STATUS_COLOR: Record<Status, string> = {
  todo: C.statusTodo,
  in_progress: C.statusProgress,
  done: C.statusDone,
}

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

// Shared column grid — the header row and every task row use the same template
// so cells line up. seq · title · status · start · end · effort.
const GRID = '30px minmax(0,1fr) 108px 58px 58px 44px'
const COL_GAP = 12

/** First user-perceived character of a name, for the avatar initial. */
function initial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return Array.from(trimmed)[0].toUpperCase()
}

/** "Jul 8" style short date from a yyyy-mm-dd string (no timezone drift). */
function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return '—'
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${MONTHS[m - 1]} ${d}`
}

/** Effort label: milestone (0) → ◆, unestimated (null) → —, else "2d" / "0.5d". */
function effortLabel(estimate: number | null): string {
  if (estimate === null || estimate === undefined) return '—'
  if (estimate === 0) return '◆'
  return `${fmtDays(estimate)}d`
}

function Avatar({
  name,
  color,
  image,
  emoji,
  size = 34,
}: {
  name: string
  color: string
  image?: string
  emoji?: string
  size?: number
}) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: '#fff',
    fontWeight: 600,
    fontSize: Math.round(size * 0.42),
    background: color,
    boxShadow: `0 0 0 1px ${C.hair}`,
  }
  if (image) {
    return (
      <span style={{ ...base, background: C.panel }}>
        <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    )
  }
  if (emoji) {
    return (
      <span style={{ ...base, background: C.panel }}>
        <span style={{ fontSize: Math.round(size * 0.58), lineHeight: 1 }}>{emoji}</span>
      </span>
    )
  }
  return <span style={base}>{initial(name)}</span>
}

function StatusPill({ status }: { status: Status }) {
  const color = STATUS_COLOR[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', minWidth: 0 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span
        style={{
          color: C.muted,
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

/** Small right-aligned numeric/date cell. */
function metaCell(text: string, opts: { overdue?: boolean } = {}) {
  return (
    <span
      style={{
        fontSize: 12,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: opts.overdue ? C.overdue : C.faint,
        fontWeight: opts.overdue ? 600 : 400,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  )
}

export interface PngExportCardProps {
  projectName: string
  viewName: string
  groups: MemberGroup[]
  /** Computed start/end per task id (mirrors the List's Start/End columns). */
  planById: Map<string, WorkingPlan>
  /** yyyy-mm-dd local — used for the header stamp and overdue comparison. */
  today: string
  /** Fixed content width in px. */
  width?: number
}

export const PngExportCard = forwardRef<HTMLDivElement, PngExportCardProps>(
  function PngExportCard({ projectName, viewName, groups, planById, today, width = 860 }, ref) {
    const totalTasks = groups.reduce((n, g) => n + g.tasks.length, 0)

    const columnHeader = (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          gap: COL_GAP,
          alignItems: 'center',
          padding: '0 14px 6px',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: C.faint,
        }}
      >
        <span />
        <span>Task</span>
        <span>Status</span>
        <span style={{ textAlign: 'right' }}>Start</span>
        <span style={{ textAlign: 'right' }}>End</span>
        <span style={{ textAlign: 'right' }}>Effort</span>
      </div>
    )

    return (
      <div
        ref={ref}
        style={{
          width,
          fontFamily: FONT,
          background: C.surface,
          color: C.ink,
          padding: '28px 30px 22px',
          boxSizing: 'border-box',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 500 }}>{projectName}</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 2 }}>
              {viewName}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, color: C.faint }}>{shortDate(today)}</div>
            <div style={{ fontSize: 12, color: C.faint }}>
              {totalTasks} task{totalTasks === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: C.hair, margin: '18px 0 14px' }} />

        {/* Member sections */}
        {groups.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: C.faint, fontSize: 14 }}>
            No tasks to show.
          </div>
        ) : (
          <>
            {columnHeader}
            {groups.map((g, gi) => {
              const name = g.member?.name ?? 'Unassigned'
              const color = g.member ? g.member.color || colorForName(name) : C.faint
              const done = g.tasks.filter((t) => t.status === 'done').length
              return (
                <div key={g.member?.id ?? '__unassigned'} style={{ marginTop: gi === 0 ? 0 : 20 }}>
                  {/* Section header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '0 2px 8px' }}>
                    {g.member ? (
                      <Avatar
                        name={name}
                        color={color}
                        image={g.member.avatarImage}
                        emoji={g.member.avatarEmoji}
                      />
                    ) : (
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: C.panel,
                          color: C.faint,
                          fontSize: 16,
                          boxShadow: `0 0 0 1px ${C.hair}`,
                        }}
                      >
                        ?
                      </span>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
                      {g.member?.title ? (
                        <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{g.member.title}</div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>
                      {done}/{g.tasks.length} done
                    </div>
                  </div>

                  {/* Task rows */}
                  <div style={{ background: C.panel, borderRadius: 12, overflow: 'hidden' }}>
                    {g.tasks.map((t, ti) => {
                      const plan = planById.get(t.id)
                      const start = plan?.startDate ?? t.startDate
                      const isMilestone = t.estimate === 0
                      const end = isMilestone ? start : (plan?.dueDate ?? t.dueDate)
                      const overdueRef = isMilestone ? start : end
                      const overdue = !!overdueRef && t.status !== 'done' && overdueRef < today
                      return (
                        <div
                          key={t.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: GRID,
                            gap: COL_GAP,
                            alignItems: 'center',
                            padding: '9px 14px',
                            borderTop: ti === 0 ? 'none' : `1px solid ${C.hair}`,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              color: C.faint,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            #{t.sequence}
                          </span>
                          <span
                            style={{
                              minWidth: 0,
                              fontSize: 13.5,
                              color: C.ink,
                              textDecoration: t.status === 'done' ? 'line-through' : 'none',
                              opacity: t.status === 'done' ? 0.55 : 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {t.title || 'Untitled'}
                          </span>
                          <StatusPill status={t.status} />
                          {metaCell(shortDate(start))}
                          {metaCell(isMilestone ? '—' : shortDate(end), { overdue })}
                          {metaCell(effortLabel(t.estimate))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* Footer watermark */}
        <div
          style={{
            marginTop: 22,
            paddingTop: 12,
            borderTop: `1px solid ${C.hair}`,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            color: C.faint,
            fontSize: 11.5,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: C.accent,
              display: 'inline-block',
            }}
          />
          <span>Made with plan-up</span>
        </div>
      </div>
    )
  }
)
