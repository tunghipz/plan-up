import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Plus, X } from 'lucide-react'
import type { DateRange } from './DatePicker'
import { CalendarGrid } from './DatePicker'
import { usePinnedPopover } from './usePinnedPopover'
import { setProjectHolidays, uid } from './db'
import { expandHolidays } from './scheduling'
import { formatShortDate, fmtDays, holidayWorkDays, holidayLoadInSpan } from './lib'
import type { Holiday, Project } from './types'

/**
 * Project-wide days off (Tết, national holidays, a team offsite) — see
 * design-docs/project-holidays.md.
 *
 * Range entry is **two-tap**: click the first day, the band previews live under
 * the cursor, click the second to commit. That is not a new idiom — it is the
 * exact state machine `DateRangePopover` already runs for collection Start/End,
 * driving the same `CalendarGrid`. A drag gesture was rejected: you cannot press
 * the month arrow while holding the mouse down, so a run that straddles a month
 * boundary (the year-end bridge, 31 Dec → 3 Jan) becomes unenterable, and it
 * dies on touch.
 *
 * The calendar shows **two months side by side** so the straddling case needs no
 * page-flip at all.
 */

const ymOf = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return { y, m: m - 1 }
}
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const nextMonth = (v: { y: number; m: number }) => {
  const d = new Date(v.y, v.m + 1, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

/** Holidays overlapping `range` (inclusive), clipped to it. Used for the sprint-scoped count. */
function holidaysInRange(holidays: Holiday[], range: DateRange): Holiday[] {
  return holidays
    .filter((h) => h.to >= range.start && h.from <= range.end)
    .map((h) => ({
      ...h,
      from: h.from < range.start ? range.start : h.from,
      to: h.to > range.end ? range.end : h.to,
    }))
}

const spanLabel = (h: Pick<Holiday, 'from' | 'to' | 'half'>) =>
  h.from === h.to
    ? `${formatShortDate(h.from)}${h.half ? (h.half === 'am' ? ' · AM' : ' · PM') : ''}`
    : `${formatShortDate(h.from)} – ${formatShortDate(h.to)}`

export function ProjectHolidaysButton({
  project,
  variant = 'row',
  range,
}: {
  project: Project
  /**
   * `'row'` = the `Holidays` row in the sprint header card (named pills + `+`);
   * `'metric'` = the always-visible settings line.
   */
  variant?: 'row' | 'metric'
  /**
   * Sprint window. Present (sprint view) → the trigger counts only holidays
   * landing inside it, mirroring `MemberDaysOffButton`. Absent (settings) → the
   * full aggregate. Display only: the picker itself is never clamped, because a
   * holiday is a property of the year, not of the sprint you happen to be in.
   */
  range?: DateRange
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [month, setMonth] = useState(() => ymOf(todayISO()))
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const holidays = useMemo(
    () => [...(project.holidays ?? [])].sort((a, b) => a.from.localeCompare(b.from)),
    [project.holidays]
  )
  const visible = range ? holidaysInRange(holidays, range) : holidays
  // Union by date, not a per-period sum: two overlapping periods share days, and
  // this badge is a TOTAL. Summing gave "6d holidays" beside a member chip
  // reading "5d holiday" and a Timeline hatching 5 columns.
  // See design-docs/project-holidays.md.
  const totalDays = holidayLoadInSpan(
    visible,
    range
      ? { start: range.start, end: range.end }
      : visible.length
        ? { start: visible[0].from, end: visible.reduce((m, h) => (h.to > m ? h.to : m), visible[0].to) }
        : null
  ).days
  const count = visible.length

  const clearDraft = () => {
    setStart(null)
    setEnd(null)
    setName('')
  }
  const close = () => {
    setOpen(false)
    clearDraft()
  }

  const pos = usePinnedPopover({
    open,
    onClose: close,
    // Esc closes the top layer only (design-system §6.5). A half-picked range IS
    // a layer: the first Esc drops it, a second closes the popover — otherwise a
    // mis-click forces you to reopen and re-navigate to the month.
    onEscape: () => {
      if (start) clearDraft()
      else close()
    },
    anchorRef: btnRef,
    popRef,
    place: () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return null
      const w = popRef.current?.offsetWidth ?? 0
      // The row starts at the card's left margin, so it pins LEFT (clamped so a
      // 520px popover can't run off a narrow window); the settings metric line
      // sits at the right of a drawer, so it pins RIGHT.
      const side: Record<string, number> =
        variant === 'row'
          ? { left: Math.max(8, Math.min(rect.left, window.innerWidth - 8 - w)) }
          : { right: Math.max(8, window.innerWidth - rect.right) }
      const h = popRef.current?.offsetHeight ?? 0
      let top = rect.bottom + 6
      // Flip above the trigger when it would run off the bottom. A two-month
      // calendar plus the saved list is tall, and the part that falls off the
      // screen is the footer — the name field and Add button, i.e. exactly the
      // part you need to finish the job. If it fits neither way, sit at the
      // bottom margin and let the popover's own max-height scroll it.
      if (h && top + h > window.innerHeight - 8) {
        const above = rect.top - h - 6
        top = above >= 8 ? above : Math.max(8, window.innerHeight - 8 - h)
      }
      return { top, ...side }
    },
  }) as { top: number; left?: number; right?: number } | null

  /**
   * Two-tap, identical in behaviour to `DateRangePopover.pick`: no start yet (or
   * a completed range) begins a fresh one; a click BEFORE the pending start moves
   * the start rather than erroring; otherwise the range closes.
   */
  const pick = (iso: string) => {
    if (!start || end) {
      setStart(iso)
      setEnd(null)
      return
    }
    if (iso < start) {
      setStart(iso)
      return
    }
    setEnd(iso)
    // The name is the only thing left to supply — put the caret there.
    requestAnimationFrame(() => nameRef.current?.focus())
  }

  const save = async () => {
    if (!start || !end) return
    const next: Holiday[] = [
      ...holidays,
      { id: uid(), name: name.trim() || 'Untitled', from: start, to: end },
    ]
    clearDraft()
    await setProjectHolidays(project.id, next)
  }
  const remove = async (id: string) => {
    await setProjectHolidays(
      project.id,
      holidays.filter((h) => h.id !== id)
    )
  }

  const draftDays =
    start && end ? holidayWorkDays({ from: start, to: end }) : 0
  const hint = !start
    ? 'Pick the first day'
    : !end
      ? `${formatShortDate(start)} – …`
      : `${formatShortDate(start)} – ${formatShortDate(end)} · ${fmtDays(draftDays)}d`

  const label =
    count > 0
      ? `${fmtDays(totalDays)}d holiday${totalDays === 1 ? '' : 's'}`
      : range
        ? 'No holidays this sprint'
        : 'No holidays'

  // Saved holidays render with the SAME orange days-off dot the date picker
  // already uses for "someone is off this day" — deliberately not an accent
  // fill, because accent fill means "the range you are picking right now" in
  // every other picker in the app. Two states, two visuals, no collision.
  const savedDots = useMemo(() => expandHolidays(holidays), [holidays])

  return (
    <>
      {variant === 'metric' ? (
        <span ref={btnRef} className="inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={`inline-flex items-center gap-1.5 transition text-[12px] ${
            count > 0 ? 'text-ink-muted' : 'text-ink-faint'
          } hover:text-ink`}
          title={count > 0 ? 'Click to edit project holidays' : 'Set project holidays'}
          aria-label="Project holidays"
        >
          <CalendarDays size={13} />
          <span className="whitespace-nowrap">{label}</span>
        </button>
        </span>
      ) : (
        // The row: label + one pill PER NAMED holiday + a `+`. Names, not one
        // rolled-up number — the name is what people remember and what tells a
        // public holiday apart from a team offsite, so the row reads without
        // being clicked. Every trigger in here opens the same popover, anchored
        // to the ROW (this span) rather than to whichever pill was pressed, so
        // it doesn't jump around. See design-docs/project-holidays.md.
        <span ref={btnRef} className="inline-flex items-center gap-2 flex-wrap min-w-0">
          {visible.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // Open on the month this holiday lives in, not today's.
                setMonth(ymOf(h.from))
                setOpen(true)
              }}
              className="inline-flex items-center gap-1.5 max-w-[280px] rounded-full bg-accent-tint px-2.5 py-1 text-[12.5px] text-accent transition hover:bg-accent-soft"
              title={`${fmtDays(holidayWorkDays(h))} working day${holidayWorkDays(h) === 1 ? '' : 's'} — click to edit`}
              aria-label={`Edit holiday ${h.name}`}
            >
              <span className="truncate">{h.name}</span>
              <span className="tabular-nums opacity-70 whitespace-nowrap">
                · {spanLabel(h)}
              </span>
            </button>
          ))}
          {count > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] text-ink-faint transition hover:bg-surface-hover hover:text-accent"
              title="Add a holiday"
              aria-label="Add holiday period"
            >
              <Plus size={14} />
            </button>
          ) : (
            // Resting: quiet dashed pill — calm at rest, accent on hover (the
            // same affordance grammar as MemberDaysOffButton's "Days off").
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-strong px-2.5 py-1 text-[12.5px] font-medium text-ink-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent"
              title="Set days off for the whole project"
              aria-label="Project holidays"
            >
              <Plus size={13} />
              <span className="whitespace-nowrap">Add holiday</span>
            </button>
          )}
        </span>
      )}

      {open &&
        createPortal(
          <div
            ref={popRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left, right: pos?.right }}
            className="z-50 glass-popover rounded-[14px] p-3 w-[520px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto"
          >
            <div className="text-[11px] text-ink-faint px-1 pb-2">
              Project holidays — everyone in {project.name} is off
            </div>

            {/* Two months, one shared `month` state → they step together. */}
            <div className="flex gap-3">
              <div className="flex-1 min-w-0">
                <CalendarGrid
                  value={start ?? end ?? null}
                  onSelect={pick}
                  daysOff={savedDots}
                  rangeStart={start}
                  rangeEnd={end}
                  selectingEnd={!!start && !end}
                  month={month}
                  onMonthChange={setMonth}
                  nav="prev"
                />
              </div>
              <div className="flex-1 min-w-0">
                <CalendarGrid
                  value={start ?? end ?? null}
                  onSelect={pick}
                  daysOff={savedDots}
                  rangeStart={start}
                  rangeEnd={end}
                  selectingEnd={!!start && !end}
                  month={nextMonth(month)}
                  onMonthChange={(v) => setMonth({ y: v.y, m: v.m - 1 })}
                  nav="next"
                  autoFocus={false}
                />
              </div>
            </div>

            <div className="mt-2.5 pt-2.5 border-t border-border-hair flex items-center gap-2">
              <span className="text-[12px] font-medium text-ink-muted tabular-nums px-1 whitespace-nowrap">
                {hint}
              </span>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void save()
                  }
                }}
                placeholder="Name it (Tết, Quốc khánh…)"
                disabled={!start || !end}
                className="flex-1 min-w-0 text-sm bg-canvas border border-border rounded-[8px] px-2 py-1 outline-none focus:border-accent transition disabled:opacity-40 placeholder:text-ink-faint"
                aria-label="Holiday name"
              />
              <button
                type="button"
                onClick={() => void save()}
                disabled={!start || !end}
                aria-label="Add holiday"
                className="text-sm px-2.5 py-1 rounded-[8px] bg-accent text-white disabled:opacity-40 transition"
              >
                Add
              </button>
            </div>

            <div className="mt-2 pt-2 border-t border-border-hair">
              {holidays.length === 0 ? (
                <div className="text-sm text-ink-faint px-1 py-1">
                  No project holidays yet. Weekends are already off.
                </div>
              ) : (
                <div className="max-h-40 overflow-auto -mx-1">
                  {holidays.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center gap-2 px-1.5 py-1 rounded-[8px] hover:bg-surface-hover group/hol"
                    >
                      <span className="text-sm text-ink flex-1 min-w-0 truncate">
                        {h.name}
                      </span>
                      <span className="text-[12px] text-ink-muted tabular-nums whitespace-nowrap">
                        {spanLabel(h)}
                      </span>
                      <span className="text-[11px] font-medium text-ink-muted bg-fill rounded-full px-1.5 py-0.5 tabular-nums whitespace-nowrap">
                        {fmtDays(holidayWorkDays(h))}d
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(h.id)}
                        className="text-ink-faint hover:text-overdue opacity-0 group-hover/hol:opacity-100 transition shrink-0"
                        aria-label={`Remove ${h.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-ink-faint px-1 pt-1.5">
                Counted in working days — weekends inside a holiday are already off.
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
