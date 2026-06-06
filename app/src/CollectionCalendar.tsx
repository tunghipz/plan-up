import { useState } from 'react'
import {
  buildMonthGrid,
  assignLanes,
  computeBarSegments,
  type CalItem,
} from './lib'
import type { Collection, Task } from './db'

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

const TODAY = new Date().toISOString().slice(0, 10)

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
}: {
  collection: Collection
  items: Task[]
}) {
  const [view, setView] = useState(() => {
    const d = new Date()
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
  })

  const step = (delta: number) => {
    setView((v) => {
      const m = v.m + delta
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 }
    })
  }

  const taskById = new Map(items.map((t) => [t.id, t]))
  const statusColorById = new Map(
    collection.statuses.map((s) => [s.id, s.color])
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

  const cal: CalItem[] = items
    .filter((t) => t.startDate)
    .map((t) => ({
      id: t.id,
      start: t.startDate as string,
      end: t.dueDate ?? (t.startDate as string),
    }))

  const grid = buildMonthGrid(view.y, view.m, TODAY)
  const lanes = assignLanes(cal)
  const segs = computeBarSegments(cal, grid, lanes)
  const maxLane = cal.reduce((m, c) => Math.max(m, lanes.get(c.id) ?? 0), 0)

  const gridTemplateRows = `30px repeat(${maxLane + 1}, 23px) 1fr`
  const minWeekHeight = 30 + (maxLane + 1) * 23 + 14

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
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
                    className="z-[1] h-[21px] my-px flex items-center gap-[3px] px-[9px] text-[11.5px] font-semibold whitespace-nowrap overflow-hidden cursor-default relative transition hover:brightness-95"
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
    </div>
  )
}
