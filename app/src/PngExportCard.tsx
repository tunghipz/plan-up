import { forwardRef } from 'react'
import type { Priority, Status, Task } from './types'
import { STATUS_LABEL, fmtDays, effectiveDaysOff, daysOffInRange } from './lib'
import { colorForName } from './schema'
import type { WorkingPlan } from './scheduling'
import type { MemberGroup } from './png-export'

/**
 * The off-screen card that becomes the exported PNG (design-docs/export-png.md).
 * Deliberately styled with INLINE HEX — no Tailwind classes, CSS vars or
 * `oklch()` — so `modern-screenshot` renders it identically regardless of the
 * app's cascade/theme. Always the light palette: shareable images must be
 * predictable and readable on a chat background. Mirrors the List view 1:1:
 * columns ID · Task · Effort (day) · Start · End · Status, a rich member header
 * (progress ring · done/total · overdue · next deadline · days off), the
 * Urgent/High priority pill, the ◆ Milestone tag, and nested subtasks.
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
  accentSoft: '#eaf2fe',
  overdue: '#ff3b30',
  ringTrack: '#e2e2e6',
  statusTodo: '#8e8e93',
  statusProgress: '#0071e3',
  statusDone: '#34c759',
}

const STATUS_COLOR: Record<Status, string> = {
  todo: C.statusTodo,
  in_progress: C.statusProgress,
  done: C.statusDone,
}
// Soft-tint bg + readable fg per status, approximating the app's color-mix pills.
const STATUS_PILL: Record<Status, { bg: string; fg: string }> = {
  todo: { bg: 'rgba(142,142,147,0.16)', fg: '#5a5a5f' },
  in_progress: { bg: 'rgba(0,113,227,0.14)', fg: '#1a5aa8' },
  done: { bg: 'rgba(52,199,89,0.16)', fg: '#248a3d' },
}
// Priority pill — only urgent/high show (matches PRIORITY_TAG in the app).
const PRIORITY_PILL: Partial<Record<Priority, { label: string; bg: string; fg: string }>> = {
  urgent: { label: 'Urgent', bg: 'rgba(255,59,48,0.12)', fg: '#c62d24' },
  high: { label: 'High', bg: 'rgba(255,149,0,0.15)', fg: '#b56a00' },
}

const FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

// Shared column grid — header row and every task row use the same template so
// cells line up. seq · title · effort · start · end · status.
const GRID = '28px minmax(0,1fr) 86px 60px 60px 116px'
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

/** Effort label: bare day count (unit lives in the header); milestone/unset → —. */
function effortLabel(estimate: number | null): string {
  if (estimate === null || estimate === undefined || estimate === 0) return '—'
  return fmtDays(estimate)
}

/** Per-member roll-up over LEAF tasks (parents excluded), mirroring MemberCard. */
function memberStats(tasks: Task[], planById: Map<string, WorkingPlan>, today: string) {
  const childParentIds = new Set<string>()
  for (const t of tasks) {
    if (t.parentId && tasks.some((x) => x.id === t.parentId)) childParentIds.add(t.parentId)
  }
  const leaf = tasks.filter((t) => !childParentIds.has(t.id))
  const total = leaf.length
  const done = leaf.filter((t) => t.status === 'done').length
  const pct = total ? Math.round((done / total) * 100) : 0
  let overdue = 0
  let nextDue: string | null = null
  for (const t of leaf) {
    if (t.status === 'done') continue
    const plan = planById.get(t.id)
    const due = t.estimate === 0 ? (plan?.startDate ?? t.startDate) : (plan?.dueDate ?? t.dueDate)
    if (!due) continue
    if (due < today) overdue++
    else if (!nextDue || due < nextDue) nextDue = due
  }
  return { total, done, pct, overdue, nextDue }
}

function CalendarGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke={C.faint} strokeWidth="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" stroke={C.faint} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function Avatar({
  name,
  color,
  image,
  emoji,
  size,
}: {
  name: string
  color: string
  image?: string
  emoji?: string
  size: number
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

/** Avatar with the Activity-ring style progress arc (green = % done). */
function AvatarRing({
  name,
  color,
  image,
  emoji,
  pct,
}: {
  name: string
  color: string
  image?: string
  emoji?: string
  pct: number
}) {
  return (
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: `conic-gradient(${C.statusDone} 0 ${pct}%, ${C.ringTrack} ${pct}% 100%)`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: C.surface,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Avatar name={name} color={color} image={image} emoji={emoji} size={32} />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: Status }) {
  const c = STATUS_PILL[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        justifySelf: 'start',
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: '3px 9px',
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }}
      />
      {STATUS_LABEL[status]}
    </span>
  )
}

function PriorityPill({ priority }: { priority: Priority }) {
  const p = PRIORITY_PILL[priority]
  if (!p) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: p.bg,
        color: p.fg,
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      {p.label}
    </span>
  )
}

function MilestoneTag() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: C.accentSoft,
        color: C.accent,
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 1.5, background: C.accent, transform: 'rotate(45deg)' }} />
      Milestone
    </span>
  )
}

/** Right-aligned tabular numeric/date cell. */
function metaCell(text: string, opts: { overdue?: boolean; center?: boolean } = {}) {
  return (
    <span
      style={{
        fontSize: 12,
        textAlign: opts.center ? 'center' : 'right',
        fontVariantNumeric: 'tabular-nums',
        color: opts.overdue ? C.overdue : '#48484c',
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
  /** Sprint range — scopes each member's days-off count (like the List header). */
  sprintStart: string
  sprintEnd: string
  /** yyyy-mm-dd local — used for the header stamp and overdue comparison. */
  today: string
  /** Fixed content width in px. */
  width?: number
}

export const PngExportCard = forwardRef<HTMLDivElement, PngExportCardProps>(
  function PngExportCard(
    { projectName, viewName, groups, planById, sprintStart, sprintEnd, today, width = 860 },
    ref
  ) {
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
          letterSpacing: '0.045em',
          textTransform: 'uppercase',
          color: C.faint,
        }}
      >
        <span>ID</span>
        <span>Task</span>
        <span style={{ textAlign: 'center' }}>Effort (day)</span>
        <span style={{ textAlign: 'right' }}>Start</span>
        <span style={{ textAlign: 'right' }}>End</span>
        <span>Status</span>
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

        <div style={{ height: 1, background: C.hair, margin: '16px 0 8px' }} />

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
              const { total, done, pct, overdue, nextDue } = memberStats(g.tasks, planById, today)
              const off = g.member
                ? effectiveDaysOff(daysOffInRange(g.member.daysOff ?? [], sprintStart, sprintEnd))
                : 0
              // Children (nested under an in-group parent) get an indent.
              const childIds = new Set(
                g.tasks
                  .filter((t) => t.parentId && g.tasks.some((x) => x.id === t.parentId))
                  .map((t) => t.id)
              )
              return (
                <div key={g.member?.id ?? '__unassigned'} style={{ marginTop: gi === 0 ? 12 : 20 }}>
                  {/* Section header — progress ring + name + stats */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 2px 8px' }}>
                    {g.member ? (
                      <AvatarRing
                        name={name}
                        color={color}
                        image={g.member.avatarImage}
                        emoji={g.member.avatarEmoji}
                        pct={pct}
                      />
                    ) : (
                      <span
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: C.panel,
                          color: C.faint,
                          fontSize: 18,
                          boxShadow: `0 0 0 1px ${C.hair}`,
                        }}
                      >
                        ?
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.15 }}>{name}</div>
                      {g.member?.title ? (
                        <div style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{g.member.title}</div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#3a3a3c' }}>
                        {done}/{total}
                      </span>
                      {overdue > 0 && (
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#c62d24',
                            background: 'rgba(255,59,48,0.12)',
                            borderRadius: 999,
                            padding: '2px 8px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {overdue} overdue
                        </span>
                      )}
                      {nextDue && (
                        <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>
                          due {shortDate(nextDue)}
                        </span>
                      )}
                      {off > 0 && (
                        <span
                          style={{
                            fontSize: 12,
                            color: C.faint,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <CalendarGlyph />
                          {fmtDays(off)} {off === 1 ? 'day' : 'days'} off
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Task rows */}
                  <div style={{ background: C.panel, borderRadius: 12, overflow: 'hidden' }}>
                    {g.tasks.map((t, ti) => {
                      const plan = planById.get(t.id)
                      const start = plan?.startDate ?? t.startDate
                      const isMilestone = t.estimate === 0
                      const end = isMilestone ? null : (plan?.dueDate ?? t.dueDate)
                      const overdueRef = isMilestone ? start : end
                      const overdue = !!overdueRef && t.status !== 'done' && overdueRef < today
                      const isChild = childIds.has(t.id)
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
                            style={{ fontSize: 11, color: C.faint, fontVariantNumeric: 'tabular-nums' }}
                          >
                            #{t.sequence}
                          </span>
                          <span
                            style={{
                              minWidth: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 7,
                              paddingLeft: isChild ? 18 : 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13.5,
                                color: isChild ? '#3a3a3c' : C.ink,
                                textDecoration: t.status === 'done' ? 'line-through' : 'none',
                                opacity: t.status === 'done' ? 0.5 : 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isChild ? '↳ ' : ''}
                              {t.title || 'Untitled'}
                            </span>
                            <PriorityPill priority={t.priority} />
                            {isMilestone && <MilestoneTag />}
                          </span>
                          {metaCell(effortLabel(t.estimate), { center: true })}
                          {metaCell(shortDate(start))}
                          {metaCell(isMilestone ? '—' : shortDate(end), { overdue })}
                          <StatusPill status={t.status} />
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
          <span style={{ width: 12, height: 12, borderRadius: 3, background: C.accent, display: 'inline-block' }} />
          <span>Made with plan-up</span>
        </div>
      </div>
    )
  }
)
