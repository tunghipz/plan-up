import { useMemo, useState } from 'react'
import { Lock, AlertTriangle, Image, ArrowUpRight, Sun, Moon } from 'lucide-react'
import type { Priority, Status, Task } from './types'
import type { WorkingPlan } from './scheduling'
import { decodeSnapshot, laneRows } from './share-snapshot'
import { groupTasksByMember } from './png-export'
import { StatusPill } from './StatusPill'
import { STATUS_META } from './sprint-logic'
import { formatShortDate, formatSprintRange, fmtDays, PRIORITY_TAG, useDarkMode } from './lib'
import { colorForName } from './schema'
import { ExportImageModal } from './ExportImageModal'

/**
 * Recipient side of the share link. main.tsx renders this INSTEAD of <App> when
 * the URL carries a `#s=…` snapshot. Purely read-only: never reads Dexie, never
 * writes anything — the board is rendered from the decoded snapshot held in
 * memory. Laid out like the Export PNG (one hairline table, member gutter, # ·
 * Task · Start · End · Effort · Status); status uses the List's pill (StatusPill).
 * See design-docs/share-link-snapshot.md.
 */

const PULSE_ORDER: Status[] = ['done', 'in_progress', 'todo']

/** Snapshots carry no scheduling data — the PNG modal only needs a non-null map. */
const EMPTY_PLAN = new Map<string, WorkingPlan>()

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
  const [exportOpen, setExportOpen] = useState(false)
  const [dark, setDark] = useDarkMode()

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
  const range = sprint.endDate
    ? formatSprintRange(sprint.startDate, sprint.endDate)
    : formatShortDate(sprint.startDate)
  const exportGroups = groupTasksByMember(data.tasks, data.members, { nestChildren: true })
  const stampYmd = /^\d{4}-\d{2}-\d{2}$/.test((data.exportedAt ?? '').slice(0, 10))
    ? data.exportedAt.slice(0, 10)
    : sprint.startDate

  // Pulse — whole-sprint status breakdown (all tasks, children included).
  const counts: Record<Status, number> = { todo: 0, in_progress: 0, done: 0 }
  for (const t of data.tasks) counts[t.status]++
  const totalTasks = data.tasks.length

  let seq = 0

  return (
    <div className="min-h-screen ambient-canvas pb-16">
      {/* Read-only header bar — a floating Liquid-Glass capsule (DNA §4 v2.1 /
          liquid-glass-material.md), 2 zones: brand · actions. Sprint lives on the
          breadcrumb line below so its name/date never squeeze against them. */}
      <div className="sticky top-0 z-20 px-3 sm:px-4 pt-3 pb-1">
        <div className="glass-toolbar rounded-full flex items-center gap-3 max-w-3xl mx-auto pl-3 pr-2 py-1.5">
        {/* Left — brand + read-only badge */}
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/favicon.svg" alt="" aria-hidden className="w-[26px] h-[26px] shrink-0 rounded-[6px]" />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[14px] font-bold tracking-[-0.01em] text-ink whitespace-nowrap">plan-up</span>
            <span className="text-[10.5px] text-ink-faint truncate">
              shared snapshot{stamp !== '—' ? ` · ${stamp}` : ''}
            </span>
          </div>
          <span
            title="dữ liệu của bạn không bị đụng tới"
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-2.5 py-1 shrink-0"
          >
            <Lock size={12} strokeWidth={2.4} aria-hidden />
            Read-only
          </span>
        </div>

        {/* Right — actions */}
        <div className="ml-auto flex items-center justify-end gap-1.5">
          <button
            onClick={() => setDark((d) => !d)}
            aria-label={dark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
            title={dark ? 'Light mode' : 'Dark mode'}
            className="inline-flex items-center justify-center rounded-[9px] p-1.5 text-ink-muted hover:bg-fill hover:text-ink transition"
          >
            {dark ? <Sun size={16} strokeWidth={2} aria-hidden /> : <Moon size={16} strokeWidth={2} aria-hidden />}
          </button>
          <button
            onClick={() => setExportOpen(true)}
            className="brand-btn inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold text-white whitespace-nowrap shrink-0 transition active:scale-[0.97] motion-reduce:active:scale-100"
          >
            <Image size={14} strokeWidth={2} aria-hidden />
            Export PNG
          </button>
          <button
            onClick={openApp}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft transition whitespace-nowrap"
          >
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Mở plan-up</span>
          </button>
        </div>
        </div>

        {/* Sprint breadcrumb — its own full-width line under the capsule so the
            name + range are never squeezed against the brand/actions zones (they
            stay whitespace-nowrap and simply take the room they need). */}
        <div className="max-w-3xl mx-auto mt-2 flex justify-center px-1">
          <div className="inline-flex items-center gap-2.5 bg-fill border border-border-hair rounded-full px-3.5 py-1.5 max-w-full">
            <span className="text-[13.5px] font-[680] tracking-[-0.01em] text-ink whitespace-nowrap">
              📋 {sprint.name} · {data.project.name}
            </span>
            <span className="w-px h-[15px] bg-border-strong shrink-0" aria-hidden />
            <span className="text-[12px] text-ink-muted tab-data whitespace-nowrap">{range}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-3 sm:px-4 pt-4 select-text">
        {/* Board floats on the ambient canvas as one glass card (DNA §4.1). */}
        <div className="glass-card rounded-[18px] px-4 sm:px-5 py-4 sm:py-5">
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

      {exportOpen && (
        <ExportImageModal
          projectName={data.project.name}
          viewName={sprint.name}
          groups={exportGroups}
          planById={EMPTY_PLAN}
          sprintStart={sprint.startDate}
          sprintEnd={sprint.endDate ?? sprint.startDate}
          today={stampYmd}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
}
