import { useMemo } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import type { Priority, Status, Task } from './types'
import { decodeSnapshot, laneRows } from './share-snapshot'
import { groupTasksByMember } from './png-export'
import { StatusPill } from './StatusPill'
import { STATUS_META } from './sprint-logic'
import { formatShortDate, formatSprintRange, fmtDays, PRIORITY_TAG } from './lib'
import { colorForName } from './schema'

/**
 * Recipient side of the share link. main.tsx renders this INSTEAD of <App> when
 * the URL carries a `#s=…` snapshot. Purely read-only: never reads Dexie, never
 * writes anything — the board is rendered from the decoded snapshot held in
 * memory. Laid out like the Export PNG (one hairline table, member gutter, # ·
 * Task · Start · End · Effort · Status); status uses the List's pill (StatusPill).
 * See design-docs/share-link-snapshot.md.
 */

const PULSE_ORDER: Status[] = ['done', 'in_progress', 'todo']

/** `MMM d` from a yyyy-mm-dd (or full ISO) string; '—' when absent/invalid. */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ymd = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? formatShortDate(ymd) : '—'
}

/** Bare day count; milestone/unset → '—' (unit lives in the header). */
function effortLabel(estimate: number | null): string {
  if (estimate === null || estimate === undefined || estimate === 0) return '—'
  return fmtDays(estimate)
}

/** Per-member roll-up over LEAF tasks (parents excluded), mirroring the PNG card. */
function memberStats(tasks: Task[]): { done: number; total: number } {
  const parentIds = new Set(
    tasks.filter((t) => t.parentId && tasks.some((x) => x.id === t.parentId)).map((t) => t.parentId)
  )
  const leaf = tasks.filter((t) => !parentIds.has(t.id))
  return { total: leaf.length, done: leaf.filter((t) => t.status === 'done').length }
}

function PriorityPill({ priority }: { priority: Priority }) {
  const p = PRIORITY_TAG[priority]
  if (!p) return null
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0"
      style={{ background: p.bg, color: p.fg }}
    >
      {p.label}
    </span>
  )
}

function MilestoneTag() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap shrink-0">
      <span className="w-[7px] h-[7px] bg-accent" style={{ transform: 'rotate(45deg)' }} />
      Milestone
    </span>
  )
}

const TH = 'text-[10px] font-semibold tracking-[0.045em] uppercase text-ink-muted text-left px-[9px] py-2'

export function SnapshotViewer({ raw }: { raw: string }) {
  const data = useMemo(() => decodeSnapshot(raw), [raw])

  const openApp = () => {
    window.location.hash = ''
    window.location.reload()
  }

  if (!data) {
    return (
      <div className="min-h-screen ambient-canvas grid place-items-center px-6">
        <div className="glass-card rounded-[18px] p-8 max-w-sm text-center space-y-4">
          <AlertTriangle size={30} strokeWidth={1.8} className="text-accent mx-auto" aria-hidden />
          <div>
            <h1 className="text-[17px] font-bold text-ink">Link không hợp lệ</h1>
            <p className="text-[13px] text-ink-muted mt-1.5">
              Snapshot hỏng, thiếu, hoặc thuộc phiên bản khác. Không có gì được mở.
            </p>
          </div>
          <button onClick={openApp} className="brand-btn text-white rounded-[10px] px-4 py-2 text-[14px] font-semibold">
            Mở plan-up
          </button>
        </div>
      </div>
    )
  }

  const sprint = data.sprint
  const groups = groupTasksByMember(data.tasks, data.members)
  const stamp = shortDate(data.exportedAt)

  // Pulse — whole-sprint status breakdown (all tasks, children included).
  const counts: Record<Status, number> = { todo: 0, in_progress: 0, done: 0 }
  for (const t of data.tasks) counts[t.status]++
  const totalTasks = data.tasks.length

  let seq = 0

  return (
    <div className="min-h-screen ambient-canvas pb-16">
      {/* Read-only banner */}
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-accent-soft border-b border-accent/20 px-5 py-3 backdrop-blur">
        <Lock size={17} strokeWidth={2} className="text-accent shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink leading-tight">Read-only snapshot</div>
          <div className="text-[11.5px] text-ink-muted truncate">
            từ “{data.project.name}”{stamp !== '—' ? ` · snapshot ${stamp}` : ''} · dữ liệu của bạn không bị đụng tới
          </div>
        </div>
        <button
          onClick={openApp}
          className="ml-auto shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent hover:underline"
        >
          Mở plan-up
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-5 pt-6 select-text">
        {/* Sprint header line — project over name, range pill right (PNG-style). */}
        <div className="flex items-baseline gap-2.5 mb-3">
          <div className="min-w-0">
            <div className="text-[12px] text-ink-muted font-medium">{data.project.name}</div>
            <div className="text-[18px] font-bold tracking-[-0.01em] text-ink">📋 {sprint.name}</div>
          </div>
          <span className="ml-auto self-center text-[12.5px] text-ink-muted tab-data bg-fill rounded-full px-2.5 py-1">
            {sprint.endDate ? formatSprintRange(sprint.startDate, sprint.endDate) : formatShortDate(sprint.startDate)}
          </span>
        </div>

        {/* Pulse — status breakdown across the whole sprint. */}
        {totalTasks > 0 && (
          <div className="bg-fill rounded-[12px] p-3 mb-4">
            <div className="h-2 rounded-full bg-[var(--color-canvas-sunk)] overflow-hidden flex">
              {PULSE_ORDER.map((s) =>
                counts[s] > 0 ? (
                  <span key={s} style={{ width: `${(counts[s] / totalTasks) * 100}%`, background: STATUS_META[s].varName }} />
                ) : null
              )}
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2 text-[11.5px] text-ink-muted">
              <span>{totalTasks} tasks</span>
              {PULSE_ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-[2px]" style={{ background: STATUS_META[s].varName }} />
                  <b className="text-ink font-semibold tab-data">{counts[s]}</b> {STATUS_META[s].label}
                </span>
              ))}
            </div>
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-ink-muted text-[13px] py-10 text-center">Sprint rỗng.</p>
        ) : (
          <table className="w-full text-[13px] cursor-default" style={{ tableLayout: 'fixed', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className={TH} style={{ width: 132, borderBottom: '1px solid var(--color-border-strong)' }}>Member</th>
                <th className={TH} style={{ width: 30, borderBottom: '1px solid var(--color-border-strong)' }}>#</th>
                <th className={TH} style={{ borderBottom: '1px solid var(--color-border-strong)' }}>Task</th>
                <th className={TH} style={{ width: 56, borderBottom: '1px solid var(--color-border-strong)' }}>Start</th>
                <th className={TH} style={{ width: 56, borderBottom: '1px solid var(--color-border-strong)' }}>End</th>
                <th className={`${TH} text-center`} style={{ width: 74, borderBottom: '1px solid var(--color-border-strong)' }}>Effort (day)</th>
                <th className={TH} style={{ width: 112, borderBottom: '1px solid var(--color-border-strong)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const name = g.member?.name ?? 'Unassigned'
                const color = g.member ? g.member.color || colorForName(name) : 'var(--color-ink-faint)'
                const rows = laneRows(g.tasks)
                const { done, total } = memberStats(g.tasks)
                const groupTop = gi === 0 ? 'none' : '2px solid var(--color-border-strong)'
                return rows.map(({ task: t, child }, ri) => {
                  seq++
                  const isMilestone = t.estimate === 0
                  const isDone = t.status === 'done'
                  const rowTop = ri === 0 ? groupTop : '1px solid var(--color-border-hair)'
                  const cell: React.CSSProperties = { borderTop: rowTop, padding: '8px 9px', verticalAlign: 'top' }
                  return (
                    <tr key={t.id}>
                      {ri === 0 && (
                        <td rowSpan={rows.length} style={{ borderTop: groupTop, padding: '11px 9px 8px', verticalAlign: 'top' }}>
                          <div className="flex items-center gap-2">
                            {g.member?.avatarImage ? (
                              <img src={g.member.avatarImage} alt={name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                            ) : (
                              <span
                                className="w-6 h-6 rounded-full grid place-items-center text-white text-[11px] font-semibold shrink-0"
                                style={{ background: color }}
                              >
                                {g.member?.avatarEmoji ?? name.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <span className="text-[13.5px] font-[650] text-ink truncate">{name}</span>
                          </div>
                          <div className="text-[11px] text-ink-faint mt-1 pl-8 tab-data">{done}/{total} done</div>
                        </td>
                      )}
                      <td style={{ ...cell }} className="text-[12px] text-ink-faint tab-data">{seq}</td>
                      <td style={{ ...cell, overflow: 'hidden' }}>
                        <span className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: child ? 18 : 0 }}>
                          <span
                            className={`text-[13.5px] truncate ${child ? 'text-ink-muted' : 'text-ink'} ${isDone ? 'line-through opacity-50' : ''}`}
                          >
                            {child ? '↳ ' : ''}
                            {t.title || 'Untitled'}
                          </span>
                          <PriorityPill priority={t.priority} />
                          {isMilestone && <MilestoneTag />}
                        </span>
                      </td>
                      <td style={{ ...cell }} className="text-[12.5px] text-ink-muted tab-data whitespace-nowrap">{shortDate(t.startDate)}</td>
                      <td style={{ ...cell }} className="text-[12.5px] text-ink-muted tab-data whitespace-nowrap">
                        {isMilestone ? '—' : shortDate(t.dueDate)}
                      </td>
                      <td style={{ ...cell }} className="text-center text-[12.5px] text-ink-muted tab-data">{effortLabel(t.estimate)}</td>
                      <td style={{ ...cell }}>
                        <StatusPill status={t.status} />
                      </td>
                    </tr>
                  )
                })
              })}
            </tbody>
          </table>
        )}

        <div className="mt-4 pt-3 border-t border-border-hair flex items-center gap-2 text-[11px] text-ink-faint">
          <span className="w-3 h-3 rounded-[3px] bg-accent inline-block" />
          Made with plan-up · read-only snapshot — không realtime, không đồng bộ về sau
        </div>
      </div>
    </div>
  )
}
