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
 * predictable and readable on a chat background.
 *
 * Layout (2026-07-09, option B of demo/export-table-layout.html): one hairline
 * table for the whole sprint — a rowSpan Member gutter on the left (avatar +
 * name + done/total), continuous 1..N numbering across the image, columns
 * # · Task · Start · End · Effort · Status, 2px grey separators between member
 * blocks. Priority pill, ◆ Milestone tag and ↳ subtask indent ride on the
 * title as before.
 */

// Light palette — hard-coded to match the light `--color-*` tokens in index.css.
const C = {
  ink: '#1d1d1f',
  muted: '#6e6e73',
  faint: '#a1a1a6',
  hair: '#e5e5ea',
  groupHair: '#c9c9cf',
  headHair: '#d7d7dc',
  surface: '#ffffff',
  panel: '#f5f5f7',
  accent: '#0071e3',
  accentSoft: '#eaf2fe',
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
  let overdue = 0
  for (const t of leaf) {
    if (t.status === 'done') continue
    const plan = planById.get(t.id)
    const due = t.estimate === 0 ? (plan?.startDate ?? t.startDate) : (plan?.dueDate ?? t.dueDate)
    if (due && due < today) overdue++
  }
  return { total, done, overdue }
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

function StatusPill({ status }: { status: Status }) {
  const c = STATUS_PILL[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
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

const CELL_PAD = '9px 12px'

function dateCell(opts: { overdue?: boolean } = {}): React.CSSProperties {
  return {
    padding: CELL_PAD,
    fontSize: 12.5,
    fontVariantNumeric: 'tabular-nums',
    color: opts.overdue ? C.overdue : '#48484c',
    fontWeight: opts.overdue ? 600 : 400,
    whiteSpace: 'nowrap',
  }
}

const TH: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '0.045em',
  textTransform: 'uppercase',
  color: C.muted,
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: `1px solid ${C.headHair}`,
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
    { projectName, viewName, groups, planById, sprintStart, sprintEnd, today, width = 940 },
    ref
  ) {
    const totalTasks = groups.reduce((n, g) => n + g.tasks.length, 0)
    // Continuous 1..N numbering across the whole image (not Task.sequence).
    let seq = 0

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

        {groups.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: C.faint, fontSize: 14 }}>
            No tasks to show.
          </div>
        ) : (
          // Fixed layout: the width-less Task column absorbs the remainder, so
          // the table can never grow past the card (auto layout + a percent
          // cell overflowed and clipped the Status pills).
          <table
            style={{
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
              width: '100%',
              marginTop: 16,
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...TH, width: 142 }}>Member</th>
                <th style={{ ...TH, width: 34 }}>#</th>
                <th style={TH}>Task</th>
                <th style={{ ...TH, width: 64 }}>Start</th>
                <th style={{ ...TH, width: 64 }}>End</th>
                <th style={{ ...TH, width: 82, textAlign: 'center' }}>Effort (day)</th>
                <th style={{ ...TH, width: 122 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const name = g.member?.name ?? 'Unassigned'
                const color = g.member ? g.member.color || colorForName(name) : C.faint
                const { total, done, overdue } = memberStats(g.tasks, planById, today)
                const off = g.member
                  ? effectiveDaysOff(daysOffInRange(g.member.daysOff ?? [], sprintStart, sprintEnd))
                  : 0
                // Children (nested under an in-group parent) get an indent.
                const childIds = new Set(
                  g.tasks
                    .filter((t) => t.parentId && g.tasks.some((x) => x.id === t.parentId))
                    .map((t) => t.id)
                )
                // 2px separator on the first row of every block after the first
                // (the thead's border already seats the first block).
                const groupBorder = gi === 0 ? 'none' : `2px solid ${C.groupHair}`
                return g.tasks.map((t, ti) => {
                  seq++
                  const plan = planById.get(t.id)
                  const start = plan?.startDate ?? t.startDate
                  const isMilestone = t.estimate === 0
                  const end = isMilestone ? null : (plan?.dueDate ?? t.dueDate)
                  const overdueRef = isMilestone ? start : end
                  const isOverdue = !!overdueRef && t.status !== 'done' && overdueRef < today
                  const isChild = childIds.has(t.id)
                  const rowBorder = ti === 0 ? groupBorder : `1px solid ${C.hair}`
                  const td: React.CSSProperties = { padding: CELL_PAD, borderTop: rowBorder }
                  return (
                    <tr key={t.id}>
                      {ti === 0 && (
                        <td
                          rowSpan={g.tasks.length}
                          style={{
                            padding: '12px 12px 9px',
                            borderTop: groupBorder,
                            verticalAlign: 'top',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {g.member ? (
                              <Avatar
                                name={name}
                                color={color}
                                image={g.member.avatarImage}
                                emoji={g.member.avatarEmoji}
                                size={24}
                              />
                            ) : (
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  flexShrink: 0,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  background: C.panel,
                                  color: C.faint,
                                  fontSize: 12,
                                  boxShadow: `0 0 0 1px ${C.hair}`,
                                }}
                              >
                                ?
                              </span>
                            )}
                            <span
                              style={{
                                fontWeight: 650,
                                fontSize: 13.5,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {name}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: C.faint,
                              marginTop: 3,
                              paddingLeft: 32,
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {done}/{total} done
                          </div>
                          {overdue > 0 && (
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#c62d24',
                                marginTop: 2,
                                paddingLeft: 32,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {overdue} overdue
                            </div>
                          )}
                          {off > 0 && (
                            <div
                              style={{
                                fontSize: 11,
                                color: C.faint,
                                marginTop: 2,
                                paddingLeft: 32,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fmtDays(off)}d off
                            </div>
                          )}
                        </td>
                      )}
                      <td
                        style={{
                          ...td,
                          fontSize: 12,
                          color: C.faint,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {seq}
                      </td>
                      <td style={{ ...td, overflow: 'hidden' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: isChild ? 18 : 0 }}>
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
                      </td>
                      <td style={{ ...dateCell(), borderTop: rowBorder }}>{shortDate(start)}</td>
                      <td style={{ ...dateCell({ overdue: isOverdue }), borderTop: rowBorder }}>
                        {isMilestone ? '—' : shortDate(end)}
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: 'center',
                          fontSize: 12.5,
                          fontVariantNumeric: 'tabular-nums',
                          color: '#48484c',
                        }}
                      >
                        {effortLabel(t.estimate)}
                      </td>
                      <td style={td}>
                        <StatusPill status={t.status} />
                      </td>
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
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
