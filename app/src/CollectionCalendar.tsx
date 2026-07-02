import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarPlus } from 'lucide-react'
import {
  buildMonthGrid,
  assignLanes,
  computeBarSegments,
  todayLocalISO,
  type CalItem,
} from './lib'
import { db, type Collection, type CollectionStatus, type Task } from './db'
import { DatePickCell, DateRangePickCell } from './DatePicker'

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Neutral fallback when an item has no (or a deleted) status. */
const NEUTRAL = '#C7C7CC'

/** Human-readable "Mon D" from a yyyy-mm-dd string (UTC, no TZ drift). */
function shortDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${d}`
}

/**
 * Month Calendar for a Collection: a Mon-start grid with seamless multi-day
 * bars that flow across week rows and chevron when they spill past the visible
 * month. All layout math comes from the tested helpers in `./lib`.
 */
export function CollectionCalendar({
  collection,
  items,
  onViewInList,
}: {
  collection: Collection
  items: Task[]
  /** Jump back to the List tab (used by the bar popover's "View in list"). */
  onViewInList?: () => void
}) {
  // Local time everywhere (matches GanttView / DatePicker / lib.todayLocalISO) —
  // the UTC slice renders the wrong day near midnight in non-UTC zones.
  const nowY = new Date().getFullYear()
  const nowM = new Date().getMonth()
  // Computed per render (NOT frozen at module load) so the "today" highlight
  // stays correct if the tab is left open across midnight.
  const today = todayLocalISO()
  const [view, setView] = useState(() => ({ y: nowY, m: nowM }))
  // Open bar editor — { item id, anchor rect } captured on click.
  const [openItem, setOpenItem] = useState<{ id: string; rect: DOMRect } | null>(
    null
  )

  const step = (delta: number) => {
    setView((v) => {
      const m = v.m + delta
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
    })
  }
  const onCurrentMonth = view.y === nowY && view.m === nowM

  const taskById = useMemo(() => new Map(items.map((t) => [t.id, t])), [items])
  const statusColorById = useMemo(
    () => new Map(collection.statuses.map((s) => [s.id, s.color])),
    [collection.statuses]
  )
  const colorForTask = (t: Task | undefined): string =>
    (t?.collectionStatusId
      ? statusColorById.get(t.collectionStatusId)
      : undefined) ?? NEUTRAL
  const statusNameForTask = (t: Task | undefined): string => {
    const id = t?.collectionStatusId
    if (!id) return 'No status'
    return collection.statuses.find((s) => s.id === id)?.name ?? 'No status'
  }

  const cal: CalItem[] = useMemo(
    () =>
      items
        .filter((t) => t.startDate)
        .map((t) => {
          const start = t.startDate as string
          // Clamp end to never precede start: the popover lets start/due be edited
          // independently, so a user can set due < start. Without this, the segment
          // span goes negative and lane-packing breaks (zero/negative-width bars).
          const rawEnd = t.dueDate ?? start
          return { id: t.id, start, end: rawEnd < start ? start : rawEnd }
        }),
    [items]
  )
  // Items with no start date never appear on the grid — surface them in an
  // "Unscheduled" tray instead of silently dropping them (a trust bug).
  const unscheduled = useMemo(() => items.filter((t) => !t.startDate), [items])

  const grid = useMemo(
    () => buildMonthGrid(view.y, view.m, today),
    [view.y, view.m, today]
  )
  const lanes = useMemo(() => assignLanes(cal), [cal])
  const segs = useMemo(
    () => computeBarSegments(cal, grid, lanes),
    [cal, grid, lanes]
  )
  // Lane count for the *displayed* month only (from its segments) — sizing off
  // ALL items would let one crowded week in another month inflate every row here.
  const maxLane = segs.reduce((m, s) => Math.max(m, s.lane), 0)

  const gridTemplateRows = `30px repeat(${maxLane + 1}, 23px) 1fr`
  const minWeekHeight = 30 + (maxLane + 1) * 23 + 14

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        {/* Legend — maps bar color → status. */}
        {collection.statuses.length > 0 ? (
          <div className="flex items-center gap-3.5 flex-wrap">
            {collection.statuses.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.name}
              </span>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {!onCurrentMonth && (
            <button
              onClick={() => setView({ y: nowY, m: nowM })}
              className="text-[12.5px] font-semibold text-accent rounded-[7px] px-2.5 py-1 hover:bg-accent-soft transition"
            >
              Today
            </button>
          )}
          <button
            onClick={() => step(-1)}
            className="w-[26px] h-[26px] rounded-[7px] bg-black/[0.05] hover:bg-black/[0.09] text-ink-muted transition grid place-items-center"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="min-w-[104px] text-center tabular-nums">
            {MONTHS_LONG[view.m]} {view.y}
          </span>
          <button
            onClick={() => step(1)}
            className="w-[26px] h-[26px] rounded-[7px] bg-black/[0.05] hover:bg-black/[0.09] text-ink-muted transition grid place-items-center"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border-hair">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="text-[11px] font-semibold text-ink-faint text-right px-3 pt-[9px] pb-2"
            >
              {w}
            </div>
          ))}
        </div>

        {grid.weeks.map((week, weekIndex) => (
          <div
            key={week.startIdx}
            data-week
            className="grid grid-cols-7 relative border-b border-border-hair last:border-b-0"
            style={{ gridTemplateRows, minHeight: `${minWeekHeight}px` }}
          >
            {/* Background cells: column separators + out-of-month tint. */}
            {week.cells.map((cell, c) => (
              <div
                key={`bg-${cell.date}`}
                className={`row-[1/-1] z-0 ${
                  c === 6 ? '' : 'border-r border-border-hair'
                } ${cell.inMonth ? '' : 'bg-black/[0.018]'}`}
                style={{ gridColumn: c + 1 }}
                aria-hidden
              />
            ))}

            {/* Day numbers (top-right; today = accent round). */}
            {week.cells.map((cell, c) => (
              <div
                key={`num-${cell.date}`}
                className={
                  cell.isToday
                    ? 'row-[1] z-[2] justify-self-end mt-[5px] mr-[7px] w-[22px] h-[22px] grid place-items-center rounded-full bg-accent text-white text-[12.5px] font-semibold leading-none'
                    : `row-[1] z-[2] justify-self-end px-[11px] pt-[7px] text-[12.5px] leading-none ${
                        cell.inMonth ? 'text-ink-muted' : 'text-ink-faint'
                      }`
                }
                style={{ gridColumn: c + 1 }}
              >
                {cell.day}
              </div>
            ))}

            {/* Bars for this week row. */}
            {segs
              .filter((s) => s.weekIndex === weekIndex)
              .map((seg) => {
                const task = taskById.get(seg.itemId)
                const color = colorForTask(task)
                const r = '999px'
                const rl = seg.roundL ? r : '0'
                const rr = seg.roundR ? r : '0'
                const title = task
                  ? `${task.title} · ${statusNameForTask(task)} · ${shortDate(
                      task.startDate as string
                    )} – ${shortDate(task.dueDate ?? (task.startDate as string))}`
                  : undefined
                return (
                  <div
                    key={`${seg.itemId}-${seg.weekIndex}`}
                    data-bar
                    title={title}
                    onClick={(e) =>
                      setOpenItem({
                        id: seg.itemId,
                        rect: (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect(),
                      })
                    }
                    className="z-[1] h-[21px] my-px flex items-center gap-[3px] px-[9px] text-[11.5px] font-semibold whitespace-nowrap overflow-hidden cursor-pointer relative transition hover:brightness-95"
                    style={{
                      gridColumn: `${seg.colStart} / span ${seg.span}`,
                      gridRow: seg.lane + 2,
                      borderRadius: `${rl} ${rr} ${rr} ${rl}`,
                      marginLeft: seg.roundL ? '4px' : '0',
                      marginRight: seg.roundR ? '4px' : '0',
                      paddingLeft: seg.roundL ? '13px' : '9px',
                      background: `color-mix(in srgb, ${color} 16%, transparent)`,
                      color,
                    }}
                  >
                    {seg.roundL && (
                      <span
                        className="absolute left-0 top-[3px] bottom-[3px] w-[3px] rounded-[3px] opacity-90"
                        style={{ background: color }}
                        aria-hidden
                      />
                    )}
                    {seg.leftChev && (
                      <span className="font-bold opacity-85 shrink-0">‹</span>
                    )}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {task?.title ?? ''}
                    </span>
                    {seg.rightChev && (
                      <span className="font-bold opacity-85 shrink-0 ml-auto">
                        ›
                      </span>
                    )}
                  </div>
                )
              })}
          </div>
        ))}
      </div>

      {cal.length === 0 && (
        <div className="text-center text-[13px] text-ink-faint py-3">
          {items.length === 0
            ? 'No items yet — add some in List.'
            : 'No items have dates yet.'}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="mt-3 bg-surface rounded-[14px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_22px_rgba(0,0,0,0.05)] px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-ink-faint tracking-wider mr-0.5">
              UNSCHEDULED · {unscheduled.length}
            </span>
            {unscheduled.map((t) => (
              <UnscheduledChip
                key={t.id}
                task={t}
                color={colorForTask(t)}
              />
            ))}
          </div>
        </div>
      )}

      {openItem &&
        (() => {
          const t = taskById.get(openItem.id)
          if (!t) return null
          return (
            <BarPopover
              task={t}
              statuses={collection.statuses}
              anchorRect={openItem.rect}
              onClose={() => setOpenItem(null)}
              onViewInList={onViewInList}
            />
          )
        })()}
    </div>
  )
}

/**
 * A chip for an item with no start date. The whole chip is the date-picker
 * trigger (a transparent DatePickCell overlay — the §5.5 hidden-control pattern):
 * pick a date and the item leaves the tray and lands on the grid, so the chip
 * never has to render a date itself.
 */
function UnscheduledChip({ task, color }: { task: Task; color: string }) {
  return (
    <span className="relative inline-flex items-center gap-1.5 h-8 bg-canvas border border-border-hair rounded-full pl-2.5 pr-2.5 text-[12.5px] cursor-pointer hover:border-accent transition">
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      <span className="max-w-[150px] truncate">{task.title || 'Untitled'}</span>
      <CalendarPlus size={13} className="text-ink-faint shrink-0" aria-hidden />
      <span className="absolute inset-0 opacity-0">
        <DatePickCell
          value={null}
          onChange={(v) => db.tasks.update(task.id, { startDate: v })}
          ariaLabel={`Schedule ${task.title || 'item'}`}
        />
      </span>
    </span>
  )
}

/**
 * Click-a-bar inline editor — portalled + fixed-positioned (the calendar card is
 * `overflow-hidden`), mirrors the StatusPill / DatePicker popover pattern. Edit
 * title · status · start/end, or jump to the List tab.
 */
/**
 * Draft-while-focused title input. Binding value={task.title} straight to the
 * liveQuery row round-trips every keystroke through Dexie's ASYNC echo — a
 * slow echo re-renders the input to an older value mid-burst (dropped chars,
 * caret jump). The row stays the source of truth whenever not editing.
 */
function TitleInput({ task }: { task: Task }) {
  const [draft, setDraft] = useState(task.title)
  const focusedRef = useRef(false)
  useEffect(() => {
    if (!focusedRef.current) setDraft(task.title)
  }, [task.title])
  return (
    <input
      value={draft}
      onFocus={() => {
        focusedRef.current = true
      }}
      onBlur={() => {
        focusedRef.current = false
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        void db.tasks.update(task.id, { title: e.target.value })
      }}
      className="w-full text-[14px] font-semibold text-ink bg-transparent border-b border-transparent focus:border-accent focus:outline-none pb-0.5"
      aria-label="Item title"
    />
  )
}

function BarPopover({
  task,
  statuses,
  anchorRect,
  onClose,
  onViewInList,
}: {
  task: Task
  statuses: CollectionStatus[]
  anchorRect: DOMRect
  onClose: () => void
  onViewInList?: () => void
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const W = 244
  // Position is pure math on the anchor rect + viewport (the popover has a fixed
  // footprint), so derive it during render — no layout-effect setState pass.
  const pos = (() => {
    let left = Math.min(anchorRect.left, window.innerWidth - 8 - W)
    left = Math.max(8, left)
    const H = 240
    let top = anchorRect.bottom + 6
    if (top + H > window.innerHeight - 8) top = Math.max(8, anchorRect.top - H - 6)
    return { top, left }
  })()

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current && popRef.current.contains(t)) return
      // The date picker portals its calendar to <body> (outside popRef). Clicks
      // there must count as "inside" — else picking a day closes this editor
      // before the selection registers. Marked via [data-calendar-popover].
      if (t instanceof Element && t.closest('[data-calendar-popover]')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The popover anchors to a snapshot rect, so it can't follow a scrolling
    // anchor — close it on scroll rather than leave it floating detached.
    // capture=true so it fires for any scroll container, not just window.
    const onScroll = () => onClose()
    // Defer so the opening click doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      window.addEventListener('scroll', onScroll, true)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: W }}
      className="z-50 bg-surface border border-border-hair rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)] p-3 space-y-2.5"
    >
      <TitleInput task={task} />
      <div className="flex flex-wrap gap-1.5">
        {statuses.map((s) => {
          const active = task.collectionStatusId === s.id
          return (
            <button
              key={s.id}
              onClick={() =>
                db.tasks.update(task.id, {
                  collectionStatusId: active ? null : s.id,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold leading-none transition"
              style={{
                background: active
                  ? `color-mix(in srgb, ${s.color} 16%, transparent)`
                  : 'transparent',
                color: active ? s.color : 'var(--color-ink-muted)',
                boxShadow: active ? 'none' : 'inset 0 0 0 1px var(--color-border)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.name}
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="text-ink-faint">Start</span>
        <span className="w-[96px]">
          <DateRangePickCell
            which="start"
            start={task.startDate}
            end={task.dueDate}
            onChange={({ start, end }) =>
              db.tasks.update(task.id, { startDate: start, dueDate: end })
            }
            ariaLabel="Start date"
            emptyHint="Start"
          />
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="text-ink-faint">End</span>
        <span className="w-[96px]">
          <DateRangePickCell
            which="end"
            start={task.startDate}
            end={task.dueDate}
            onChange={({ start, end }) =>
              db.tasks.update(task.id, { startDate: start, dueDate: end })
            }
            ariaLabel="End date"
            emptyHint="End"
          />
        </span>
      </div>
      {onViewInList && (
        <button
          onClick={() => {
            onViewInList()
            onClose()
          }}
          className="w-full text-left text-[12.5px] font-medium text-accent rounded-[7px] px-1 py-1 hover:bg-accent-soft transition"
        >
          View in list →
        </button>
      )}
    </div>,
    document.body
  )
}
