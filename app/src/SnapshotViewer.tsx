import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, AlertTriangle, Image, ArrowUpRight, Sun, Moon, Calendar } from 'lucide-react'
import type { Priority, Status, Task } from './types'
import type { WorkingPlan } from './scheduling'
import { decodeSnapshot, laneRows } from './share-snapshot'
import { groupTasksByMember } from './png-export'
import { StatusPill } from './StatusPill'
import { STATUS_META } from './sprint-logic'
import { effectiveDaysOff, formatShortDate, formatSprintRange, fmtDays, PRIORITY_TAG, useDarkMode } from './lib'
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

/** Sidebar progress ring — whole-sprint status split, % done in the middle. Replaces
 *  the old horizontal pulse strip; reads better in the narrow left rail. */
function PulseDonut({ counts, total }: { counts: Record<Status, number>; total: number }) {
  const R = 44
  const C = 2 * Math.PI * R
  let offset = 0
  const arcs = PULSE_ORDER.map((s) => {
    const len = total > 0 ? (counts[s] / total) * C : 0
    const arc = (
      <circle
        key={s}
        cx="52"
        cy="52"
        r={R}
        fill="none"
        stroke={STATUS_META[s].varName}
        strokeWidth="11"
        strokeDasharray={`${len} ${C - len}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 52 52)"
      />
    )
    offset += len
    return arc
  })
  const pctDone = total > 0 ? Math.round((counts.done / total) * 100) : 0
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24 shrink-0">
        <svg viewBox="0 0 104 104" className="w-full h-full">
          <circle cx="52" cy="52" r={R} fill="none" stroke="var(--color-canvas-sunk)" strokeWidth="11" />
          {arcs}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <div className="text-[22px] font-extrabold tracking-[-0.02em] leading-none tab-data text-ink">{pctDone}%</div>
          <div className="text-[9.5px] font-semibold text-ink-faint tracking-[0.04em] uppercase mt-0.5">done</div>
        </div>
      </div>
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        <div className="text-[12px] text-ink-faint tab-data">{total} tasks</div>
        {PULSE_ORDER.map((s) => (
          <div key={s} className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <span className="w-[9px] h-[9px] rounded-[3px] shrink-0" style={{ background: STATUS_META[s].varName }} />
            {STATUS_META[s].label}
            <b className="ml-auto text-ink font-bold tab-data">{counts[s]}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SnapshotViewer({ raw }: { raw: string }) {
  const data = useMemo(() => decodeSnapshot(raw), [raw])
  const [exportOpen, setExportOpen] = useState(false)
  const [dark, setDark] = useDarkMode()

  // Sprint-goal note: clamp to 5 lines in the sticky rail, reveal "Show more" only
  // when the note actually overflows that clamp (measured after render).
  const noteRef = useRef<HTMLParagraphElement>(null)
  const [noteExpanded, setNoteExpanded] = useState(false)
  const [noteOverflows, setNoteOverflows] = useState(false)
  const noteText = data?.sprint.note
  // A new note (different snapshot) starts collapsed so the overflow measure below runs clamped.
  useEffect(() => {
    setNoteExpanded(false)
  }, [noteText])
  // Re-measure overflow on note change AND on any resize (the rail is 300px on lg but full-width
  // when stacked below lg — the clamp threshold differs). Only update while clamped so expanding
  // (clientHeight === scrollHeight) can't wrongly hide the toggle.
  useEffect(() => {
    const el = noteRef.current
    if (!el) {
      setNoteOverflows(false)
      return
    }
    const measure = () => {
      if (!noteExpanded) setNoteOverflows(el.scrollHeight - el.clientHeight > 2)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [noteText, noteExpanded])

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
  // Off days per member (dates + half), keyed by member id.
  const offById = new Map(data.members.map((m, i) => [m.id, data.membersOff[i] ?? []]))

  // Parent (group-head) task ids — a task referenced as some task's parent. Their status is
  // already rolled up + frozen at build (buildSnapshot), so the board just renders `t.status`;
  // the donut excludes them (leaf-only, mirroring the app + this file's own memberStats) so a
  // container isn't double-counted with its children.
  const parentIds = new Set(data.tasks.map((t) => t.parentId).filter(Boolean) as string[])
  const stamp = shortDate(data.exportedAt)
  const range = sprint.endDate
    ? formatSprintRange(sprint.startDate, sprint.endDate)
    : formatShortDate(sprint.startDate)
  const exportGroups = groupTasksByMember(data.tasks, data.members, { nestChildren: true })
  const stampYmd = /^\d{4}-\d{2}-\d{2}$/.test((data.exportedAt ?? '').slice(0, 10))
    ? data.exportedAt.slice(0, 10)
    : sprint.startDate

  // Pulse — whole-sprint status breakdown over LEAF tasks only (parents excluded so a
  // group container isn't double-counted with its children; matches memberStats + the app).
  const leafTasks = data.tasks.filter((t) => !parentIds.has(t.id))
  const counts: Record<Status, number> = { todo: 0, in_progress: 0, done: 0 }
  for (const t of leafTasks) counts[t.status]++
  const totalTasks = leafTasks.length

  let seq = 0

  return (
    <div className="min-h-screen ambient-canvas pb-16">
      <div className="mx-auto max-w-[1240px] px-3 sm:px-4 pt-5 sm:pt-6 select-text">
        {/* Two columns: a sticky meta rail (brand · sprint · progress · actions) +
            the board. Was a centered max-w-3xl single column whose flanks sat empty
            on wide screens; the rail fills the left flank and lets the table breathe.
            Stacks to one column below lg. See design-docs/share-link-snapshot.md. */}
        <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">

          {/* ── Left rail — everything that used to stack across the top ── */}
          <aside className="flex flex-col gap-3.5 lg:sticky lg:top-6">
            {/* Brand + dark toggle */}
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" aria-hidden className="w-[30px] h-[30px] shrink-0 rounded-[8px]" />
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-[15px] font-bold tracking-[-0.01em] text-ink whitespace-nowrap">plan-up</span>
                <span className="text-[10.5px] text-ink-faint truncate">
                  shared snapshot{stamp !== '—' ? ` · ${stamp}` : ''}
                </span>
              </div>
              <button
                onClick={() => setDark((d) => !d)}
                aria-label={dark ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối'}
                title={dark ? 'Light mode' : 'Dark mode'}
                className="ml-auto inline-flex items-center justify-center rounded-[9px] p-1.5 text-ink-muted hover:bg-fill hover:text-ink transition"
              >
                {dark ? <Sun size={16} strokeWidth={2} aria-hidden /> : <Moon size={16} strokeWidth={2} aria-hidden />}
              </button>
            </div>
            <span
              title="dữ liệu của bạn không bị đụng tới"
              className="inline-flex w-max items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-2.5 py-1"
            >
              <Lock size={12} strokeWidth={2.4} aria-hidden />
              Read-only
            </span>

            {/* Sprint card */}
            <div className="glass-card rounded-[16px] p-4">
              <div className="text-[10px] font-bold tracking-[0.06em] uppercase text-ink-faint">Sprint</div>
              <div className="text-[15px] font-bold tracking-[-0.01em] text-ink mt-2 leading-snug">
                📋 {sprint.name} · {data.project.name}
              </div>
              <div className="inline-flex items-center gap-2 text-[12.5px] text-ink-muted mt-2.5 bg-fill rounded-full px-3 py-1.5 tab-data whitespace-nowrap">
                <Calendar size={13} strokeWidth={2} aria-hidden />
                {range}
              </div>
              {sprint.note && (
                <div className="mt-3 pt-3 border-t border-border-hair">
                  <div className="text-[10px] font-bold tracking-[0.06em] uppercase text-ink-faint mb-1.5">Goal</div>
                  <p
                    ref={noteRef}
                    className="text-[13px] leading-relaxed text-ink-muted whitespace-pre-wrap break-words"
                    style={
                      noteExpanded
                        ? undefined
                        : ({
                            display: '-webkit-box',
                            WebkitLineClamp: 5,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          } as React.CSSProperties)
                    }
                  >
                    {sprint.note}
                  </p>
                  {noteOverflows && (
                    <button
                      onClick={() => setNoteExpanded((v) => !v)}
                      aria-expanded={noteExpanded}
                      className="mt-1.5 text-[12px] font-semibold text-accent hover:underline"
                    >
                      {noteExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Progress — donut + legend (replaces the old top pulse strip) */}
            {totalTasks > 0 && (
              <div className="glass-card rounded-[16px] p-4">
                <div className="text-[10px] font-bold tracking-[0.06em] uppercase text-ink-faint mb-3.5">Progress</div>
                <PulseDonut counts={counts} total={totalTasks} />
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setExportOpen(true)}
                className="brand-btn inline-flex items-center justify-center gap-1.5 rounded-[11px] px-4 py-2.5 text-[13px] font-semibold text-white transition active:scale-[0.98] motion-reduce:active:scale-100"
              >
                <Image size={15} strokeWidth={2} aria-hidden />
                Export PNG
              </button>
              <button
                onClick={openApp}
                className="inline-flex items-center justify-center gap-1.5 rounded-[11px] px-4 py-2.5 text-[13px] font-semibold text-accent bg-fill hover:bg-accent-soft transition"
              >
                <ArrowUpRight size={15} strokeWidth={2} aria-hidden />
                Mở plan-up
              </button>
            </div>
          </aside>

          {/* ── Board — the task table (DNA §4.1 glass card) ── */}
          <main className="glass-card rounded-[18px] px-4 sm:px-5 py-4 sm:py-5 min-w-0">

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
                const offList = g.member ? offById.get(g.member.id) ?? [] : []
                const offCount = effectiveDaysOff(offList)
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
                            <div className="flex flex-col min-w-0">
                            <span className="text-[13.5px] font-[650] text-ink truncate leading-tight">{name}</span>
                            {g.member?.title && (
                              <span className="text-[11.5px] text-ink-muted truncate leading-tight tracking-[-0.008em] mt-px">
                                {g.member.title}
                              </span>
                            )}
                          </div>
                          </div>
                          <div className="text-[11px] text-ink-faint mt-1.5 pl-8 tab-data">
                            <span
                              style={
                                total > 0 && done === total
                                  ? { color: 'var(--color-status-done)', fontWeight: 600 }
                                  : undefined
                              }
                            >
                              {done}/{total} done
                            </span>
                          </div>
                          {offList.length > 0 && (
                            <div className="mt-1.5 pl-8">
                              <div className="text-[10px] font-bold tracking-[0.04em] uppercase text-ink-faint mb-1">
                                <span className="text-ink-muted tab-data">{fmtDays(offCount)}</span>{' '}
                                {offCount === 1 ? 'day' : 'days'} off
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {offList.map((o, i) => (
                                  <span
                                    key={`${o.date}-${i}`}
                                    className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-ink-muted bg-fill rounded-[6px] px-[7px] py-0.5 whitespace-nowrap tab-data"
                                  >
                                    {shortDate(o.date)}
                                    {o.half && (
                                      <span className="text-[9.5px] font-bold text-accent bg-accent-soft rounded-[4px] px-1">
                                        ½ {o.half === 'am' ? 'AM' : 'PM'}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
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
          </main>
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
