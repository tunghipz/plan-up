import { useCallback, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, computeWorkingPlan, type Task, type Member } from './db'
import { Avatar } from './members'
import { STATUS_META, derivedGroupStatus } from './SprintView'
import { sprintWorkdays, formatShortDate } from './lib'

/**
 * Timeline — an Apple-Calendar-style swimlane view of the sprint (design DNA:
 * one calm surface, depth not lines, system status colors). Each member is a
 * swimlane; each scheduled task is a soft-tinted event block placed on the day
 * axis with half-day precision and lane-packed so non-overlapping tasks share a
 * row. Tasks scheduled outside the sprint window, or with no dates, are
 * summarised as a count in the member label (click to expand). Read-only — a
 * pure projection of the auto-scheduler. See design-docs/gantt-view.md.
 */

const MGUT = 152 // member label column
const MIN_DAY = 54 // floor for a day column; widens past this to fill the surface
const EVH = 24
const ROWH = 30
const PAD_TOP = 9

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function weekday(date: string): string {
  return WD[new Date(date + 'T00:00:00Z').getUTCDay()]
}
function gapBefore(prev: string, cur: string): boolean {
  return (new Date(cur + 'T00:00:00Z').getTime() - new Date(prev + 'T00:00:00Z').getTime()) / 86_400_000 > 1
}
const softBg = (v: string) => `color-mix(in srgb, ${v} 15%, transparent)`
const softFg = (v: string) => `color-mix(in srgb, ${v} 100%, #000 22%)`

type Ev = {
  task: Task
  status: keyof typeof STATUS_META
  left: number
  width: number
  contLeft: boolean
  contRight: boolean
  lane: number
  isParent: boolean
}

export function GanttView({
  projectId,
  sprintStartDate,
  sprintEndDate,
  tasks,
  search,
}: {
  projectId: string
  sprintStartDate: string
  sprintEndDate: string
  tasks: Task[]
  search: string
}) {
  const members = useLiveQuery(
    () => db.members.where('projectId').equals(projectId).toArray(),
    [projectId]
  )
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const workdays = useMemo(
    () => sprintWorkdays(sprintStartDate, sprintEndDate),
    [sprintStartDate, sprintEndDate]
  )
  const seamSet = useMemo(() => {
    const s = new Set<number>()
    for (let i = 1; i < workdays.length; i++) if (gapBefore(workdays[i - 1], workdays[i])) s.add(i)
    return s
  }, [workdays])

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  // Parent → children (across all tasks). A parent group has no own dates; its
  // Timeline bar is a summary spanning its children (mirrors the List roll-up).
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.parentId) continue
      const arr = m.get(t.parentId)
      arr ? arr.push(t) : m.set(t.parentId, [t])
    }
    return m
  }, [tasks])
  const memberById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m] as [string, Member])),
    [members]
  )

  const N = workdays.length
  const firstDay = workdays[0]
  const lastDay = workdays[N - 1]

  // Fluid columns: widen each day to fill the surface so a short sprint leaves no
  // dead white space on the right. Clamped to MIN_DAY → a long sprint scrolls instead.
  // Callback ref (not useRef + effect) so the observer attaches when the card actually
  // mounts — the card is absent during the loading branch, so a once-on-mount effect
  // would measure null and never re-run.
  const roRef = useRef<ResizeObserver | null>(null)
  const [availW, setAvailW] = useState(0)
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!node) return
    const ro = new ResizeObserver(([entry]) => setAvailW(entry.contentRect.width))
    ro.observe(node)
    setAvailW(node.clientWidth)
    roRef.current = ro
  }, [])
  const dayW = availW > 0 && N > 0 ? Math.max(MIN_DAY, (availW - MGUT) / N) : MIN_DAY

  const groups = useMemo(() => {
    const ms = members ?? []
    const byMember = new Map<string, Task[]>()
    for (const m of ms) byMember.set(m.id, [])
    for (const t of filteredTasks) {
      if (t.assigneeId && byMember.has(t.assigneeId)) byMember.get(t.assigneeId)!.push(t)
    }
    return ms
      .filter((m) => (byMember.get(m.id) ?? []).length > 0)
      .map((m) => {
        const evs: Ev[] = []
        const offWindow: {
          task: Task
          date: string
          status: keyof typeof STATUS_META
          dir: 'earlier' | 'later'
        }[] = []
        const noDates: Task[] = []
        for (const task of byMember.get(m.id)!.sort((a, b) => a.sequence - b.sequence)) {
          const kids = childrenByParent.get(task.id)
          const isParent = !!kids && kids.length > 0
          let sd: string | null
          let dd: string | null
          let startTime: string
          let endTime: string
          let status: keyof typeof STATUS_META
          if (isParent) {
            // Parent summary: span = earliest child start … latest child end
            // (the same roll-up the List group row shows). Time-aware ordering.
            status = derivedGroupStatus(kids!) as keyof typeof STATUS_META
            sd = null
            dd = null
            startTime = '08:00'
            endTime = '17:00'
            let minKey: string | null = null
            let maxKey: string | null = null
            for (const c of kids!) {
              const p = computeWorkingPlan(c, tasksById, memberById)
              if (p.startDate) {
                const k = `${p.startDate}T${p.startTime}`
                if (!minKey || k < minKey) (minKey = k), (sd = p.startDate), (startTime = p.startTime)
              }
              if (p.dueDate) {
                const k = `${p.dueDate}T${p.endTime}`
                if (!maxKey || k > maxKey) (maxKey = k), (dd = p.dueDate), (endTime = p.endTime)
              }
            }
          } else {
            const plan = computeWorkingPlan(task, tasksById, memberById)
            sd = plan.startDate
            dd = plan.dueDate
            startTime = plan.startTime
            endTime = plan.endTime
            status = task.status as keyof typeof STATUS_META
          }
          if (!sd || !dd) {
            noDates.push(task)
            continue
          }
          // wholly after the window → "later" (shows its start); wholly before → "earlier"
          // (shows its end — when it finished)
          if (sd > lastDay) {
            offWindow.push({ task, date: sd, status, dir: 'later' })
            continue
          }
          if (dd < firstDay) {
            offWindow.push({ task, date: dd, status, dir: 'earlier' })
            continue
          }
          // left edge — clamp to the window's left with a caret when it starts earlier
          let left: number
          let contLeft = false
          const sIdx = workdays.indexOf(sd)
          if (sIdx < 0) {
            if (sd < firstDay) {
              left = 0
              contLeft = true
            } else {
              offWindow.push({ task, date: sd, status, dir: 'later' })
              continue
            }
          } else {
            left = sIdx * dayW + (startTime === '13:00' ? dayW / 2 : 0)
          }
          let right: number
          let contRight = false
          if (dd > lastDay) {
            right = N * dayW
            contRight = true
          } else {
            const eIdx = workdays.indexOf(dd)
            right = (eIdx < 0 ? N - 1 : eIdx) * dayW + (endTime === '12:00' ? dayW / 2 : dayW)
          }
          evs.push({
            task,
            status,
            left,
            width: Math.max(right - left, 30),
            contLeft,
            contRight,
            lane: 0,
            isParent,
          })
        }
        // Greedy lane-packing, parents first so a group's summary rail always sits
        // ABOVE its children (Gantt convention). Parents claim the top lanes; every
        // other block packs into lanes below them.
        const pack = (items: Ev[], base: number): number => {
          items.sort((a, b) => a.left - b.left)
          const laneEnds: number[] = []
          for (const e of items) {
            let placed = false
            for (let i = 0; i < laneEnds.length; i++) {
              if (laneEnds[i] <= e.left) {
                e.lane = base + i
                laneEnds[i] = e.left + e.width
                placed = true
                break
              }
            }
            if (!placed) {
              e.lane = base + laneEnds.length
              laneEnds.push(e.left + e.width)
            }
          }
          return laneEnds.length
        }
        const parentRows = pack(evs.filter((e) => e.isParent), 0)
        const childRows = pack(evs.filter((e) => !e.isParent), parentRows)
        const rows = Math.max(1, parentRows + childRows)
        // member day-off half-columns within the window
        const offByDate = new Map<string, 'full' | 'am' | 'pm'>()
        for (const o of m.daysOff) {
          if (!o.half) offByDate.set(o.date, 'full')
          else {
            const prev = offByDate.get(o.date)
            if (prev === undefined) offByDate.set(o.date, o.half)
            else if (prev !== o.half) offByDate.set(o.date, 'full')
          }
        }
        const offBands: { left: number; width: number }[] = []
        workdays.forEach((date, i) => {
          const off = offByDate.get(date)
          if (off === 'full') offBands.push({ left: i * dayW, width: dayW })
          else if (off === 'am') offBands.push({ left: i * dayW, width: dayW / 2 })
          else if (off === 'pm') offBands.push({ left: i * dayW + dayW / 2, width: dayW / 2 })
        })
        // earlier chips first, then later — each sorted by their shown date
        offWindow.sort((a, b) =>
          a.dir !== b.dir ? (a.dir === 'earlier' ? -1 : 1) : a.date < b.date ? -1 : 1
        )
        const earlierN = offWindow.filter((o) => o.dir === 'earlier').length
        const laterN = offWindow.length - earlierN
        return { member: m, evs, rows, offWindow, earlierN, laterN, noDates, offBands }
      })
  }, [members, filteredTasks, workdays, tasksById, memberById, childrenByParent, N, firstDay, lastDay, dayW])

  if (!members) return <p className="text-ink-muted py-12 text-center">Loading…</p>
  if (N === 0)
    return (
      <div className="py-16 text-center text-sm text-ink-muted">
        This sprint has no working days (weekends only).
      </div>
    )
  if (groups.length === 0)
    return (
      <div className="py-16 text-center text-sm text-ink-muted">
        {search.trim() ? `No tasks match "${search}".` : 'No assigned tasks in this sprint yet.'}
      </div>
    )

  const innerW = MGUT + N * dayW
  const today = todayISO()
  const todayIdx = workdays.indexOf(today)

  return (
    <div className="pt-4 pb-2 max-w-full">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[12px] text-ink-muted">
        <LegendDot varName="var(--color-status-done)" label="Done" />
        <LegendDot varName="var(--color-status-progress)" label="In progress" />
        <LegendDot varName="var(--color-status-todo)" label="To do" />
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3.5 h-3.5 rounded-[4px] bg-fill" />
          Day off
        </span>
      </div>

      <div
        ref={measureRef}
        className="overflow-x-auto rounded-[14px] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)]"
      >
        <div className="relative" style={{ width: innerW }}>
          {/* Today line — continuous, behind events */}
          {todayIdx >= 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-accent/60 z-0 pointer-events-none"
              style={{ left: MGUT + todayIdx * dayW }}
              aria-hidden
            />
          )}

          {/* Sticky date header */}
          <div
            className="sticky top-0 z-20 flex bg-surface border-b border-border-hair"
          >
            <div className="sticky left-0 z-10 bg-surface" style={{ width: MGUT }} />
            {workdays.map((date, i) => (
              <div
                key={date}
                className={`flex flex-col items-center justify-center py-2.5 ${
                  seamSet.has(i) ? 'border-l border-border' : ''
                } ${date === today ? 'text-accent' : ''}`}
                style={{ width: dayW }}
              >
                <span
                  className={`text-[13.5px] font-semibold tab-data leading-none ${
                    date === today ? 'text-accent' : 'text-ink-muted'
                  }`}
                >
                  {formatShortDate(date)}
                </span>
                <span
                  className={`text-[11px] font-semibold leading-none mt-1 ${
                    date === today ? 'text-accent' : 'text-ink-faint'
                  }`}
                >
                  {weekday(date)}
                </span>
              </div>
            ))}
          </div>

          {/* Swimlanes */}
          {groups.map(({ member, evs, rows, offWindow, earlierN, laterN, noDates, offBands }) => {
            const laneH = rows * ROWH + PAD_TOP * 2
            const hasExtra = offWindow.length > 0 || noDates.length > 0
            const isOpen = expanded.has(member.id)
            const subParts: string[] = []
            if (earlierN) subParts.push(`↙ ${earlierN} earlier`)
            if (laterN) subParts.push(`↗ ${laterN} later`)
            if (noDates.length) subParts.push(`○ ${noDates.length} no dates`)
            return (
              <div key={member.id}>
                <div className="flex border-b border-border-hair/70" style={{ minHeight: laneH }}>
                  {/* sticky label */}
                  <div
                    className="sticky left-0 z-10 bg-surface flex items-start gap-2.5 px-3.5 py-2.5"
                    style={{ width: MGUT }}
                  >
                    <Avatar member={member} />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-ink truncate leading-tight">
                        {member.name}
                      </div>
                      {member.title && (
                        <div className="text-[11px] text-ink-faint truncate leading-tight">
                          {member.title}
                        </div>
                      )}
                      {hasExtra && (
                        <button
                          onClick={() => toggle(member.id)}
                          className="mt-0.5 text-[10.5px] font-medium text-ink-faint hover:text-accent transition tab-data"
                        >
                          {subParts.join(' · ')} {isOpen ? '▾' : '▸'}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* track */}
                  <div className="relative" style={{ width: N * dayW }}>
                    {/* faint day separators */}
                    {workdays.map((date, i) =>
                      i === 0 ? null : (
                        <div
                          key={date}
                          className={`absolute top-0 bottom-0 ${
                            seamSet.has(i) ? 'border-l border-border' : 'border-l border-border-hair/50'
                          }`}
                          style={{ left: i * dayW }}
                          aria-hidden
                        />
                      )
                    )}
                    {/* day-off bands */}
                    {offBands.map((o, k) => (
                      <div
                        key={k}
                        className="absolute top-0 bottom-0 bg-fill"
                        style={{ left: o.left, width: o.width }}
                        title="Day off"
                        aria-hidden
                      />
                    ))}
                    {/* event blocks */}
                    {evs.map((e) => {
                      const v = STATUS_META[e.status].varName
                      const box = {
                        left: e.left + 2,
                        width: e.width - 4,
                        top: PAD_TOP + e.lane * ROWH,
                        height: EVH,
                      }
                      // Parent group → a slim summary rail spanning its children.
                      if (e.isParent) {
                        return (
                          <div
                            key={e.task.id}
                            className="absolute flex items-center"
                            style={box}
                            title={`Group · ${e.task.title}`}
                          >
                            <span
                              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[4px] rounded-full"
                              style={{ background: `color-mix(in srgb, ${v} 45%, transparent)` }}
                              aria-hidden
                            />
                            {!e.contLeft && (
                              <span
                                className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[13px] rounded-full"
                                style={{ background: v }}
                                aria-hidden
                              />
                            )}
                            {!e.contRight && (
                              <span
                                className="absolute right-0 top-1/2 -translate-y-1/2 w-[2.5px] h-[13px] rounded-full"
                                style={{ background: v }}
                                aria-hidden
                              />
                            )}
                            <span
                              className="relative z-10 ml-1.5 inline-block max-w-full truncate rounded bg-surface px-1.5 text-[11.5px] font-semibold"
                              style={{ color: softFg(v), maxWidth: e.width - 16 }}
                            >
                              ▾ #{e.task.sequence} {e.task.title}
                            </span>
                          </div>
                        )
                      }
                      return (
                        <div
                          key={e.task.id}
                          className="absolute flex items-center rounded-[7px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                          style={{ ...box, background: softBg(v) }}
                          title={`${STATUS_META[e.status].label} · ${e.task.title}`}
                        >
                          {e.contLeft && (
                            <span className="text-ink-faint text-[11px] pl-1.5" aria-hidden>
                              ‹
                            </span>
                          )}
                          <span
                            className="self-stretch my-[3px] ml-[3px] w-[3px] rounded-full shrink-0"
                            style={{ background: v }}
                          />
                          <span
                            className="text-[11.5px] font-semibold px-2 truncate"
                            style={{ color: softFg(v) }}
                          >
                            #{e.task.sequence} {e.task.title}
                          </span>
                          {e.contRight && (
                            <span className="text-ink-faint text-[11px] pr-1.5" aria-hidden>
                              ›
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {/* expandable later / no-dates list */}
                {isOpen && hasExtra && (
                  <div
                    className="flex flex-wrap gap-1.5 px-3.5 py-2 bg-surface-hover border-b border-border-hair/70"
                    style={{ paddingLeft: MGUT }}
                  >
                    {offWindow.map(({ task, date, status, dir }) => {
                      const v = STATUS_META[status].varName
                      return (
                        <span
                          key={task.id}
                          className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5"
                          style={{ background: softBg(v), color: softFg(v) }}
                          title={`${STATUS_META[status].label} · ${task.title}`}
                        >
                          <span className="tab-data">#{task.sequence}</span>
                          <span className="max-w-[160px] truncate">{task.title}</span>
                          <span className="opacity-70">
                            {dir === 'earlier' ? '←' : '→'} {formatShortDate(date)}
                          </span>
                        </span>
                      )
                    })}
                    {noDates.map((task) => (
                      <span
                        key={task.id}
                        className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-fill text-ink-muted"
                        title={task.title}
                      >
                        <span className="tab-data">#{task.sequence}</span>
                        <span className="max-w-[160px] truncate">{task.title}</span>
                        <span className="text-ink-faint">no dates</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LegendDot({ varName, label }: { varName: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3.5 h-3.5 rounded-[4px]" style={{ background: softBg(varName) }}>
        <span className="block w-[3px] h-full rounded-full" style={{ background: varName }} />
      </span>
      {label}
    </span>
  )
}
