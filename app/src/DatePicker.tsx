import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatShortDate } from './lib'

/**
 * Custom Cupertino calendar picker — replaces the native <input type="date">
 * everywhere a date is chosen (List, Board quick-edit, sprint dialog, days-off).
 * Planner-aware: today ring, selected fill, dimmed-but-selectable weekends, and
 * orange dots for the assignee's days-off. See design-docs/date-picker.md.
 */

export type DayOff = { date: string; half?: 'am' | 'pm' }
export type DateRange = { start: string; end: string }

/**
 * Sprint date range, provided by SprintView / BoardView so task-date pickers
 * clamp + shade to the current sprint without threading the range through every
 * row. DatePickCell reads it; DateField does NOT (sprint dialog stays unclamped).
 */
export const SprintRangeContext = createContext<DateRange | null>(null)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const pad = (n: number) => String(n).padStart(2, '0')
const isoYMD = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
function todayISO() {
  const d = new Date()
  return isoYMD(d.getFullYear(), d.getMonth(), d.getDate())
}
function ymOf(s: string | null): { y: number; m: number } {
  if (s) {
    const [y, m] = s.split('-').map(Number)
    return { y, m: m - 1 }
  }
  const d = new Date()
  return { y: d.getFullYear(), m: d.getMonth() }
}
function shiftISO(s: string, days: number) {
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return isoYMD(dt.getFullYear(), dt.getMonth(), dt.getDate())
}
// Time detail for an off-day (matches the days-off select wording). The half-day
// off-window: AM = morning 08:00–12:00, PM = afternoon 13:00–17:00.
function offDetail(half?: 'am' | 'pm') {
  return half === 'am' ? 'AM off · 08:00–12:00' : half === 'pm' ? 'PM off · 13:00–17:00' : 'Off all day'
}

// ---- Month grid + keyboard nav ----
function CalendarGrid({
  value,
  onSelect,
  min,
  max,
  sprintRange,
  daysOff,
}: {
  value: string | null
  onSelect: (v: string) => void
  min?: string
  max?: string
  sprintRange?: DateRange | null
  daysOff?: DayOff[]
}) {
  // Initial focus/view: the value if set, else today nudged into the relevant range
  // so an empty picker opens on the sprint month. Uses min/max if present (days-off
  // hard clamp), else the sprintRange (task cells: shade only, still opens there).
  const initial = (() => {
    if (value) return value
    const t = todayISO()
    const lo = min ?? sprintRange?.start
    const hi = max ?? sprintRange?.end
    if (lo && t < lo) return lo
    if (hi && t > hi) return hi
    return t
  })()
  const [view, setView] = useState(() => ymOf(initial))
  const [focus, setFocus] = useState<string>(() => initial)
  const gridRef = useRef<HTMLDivElement>(null)
  const today = todayISO()
  // Only mark off-days that fall inside the sprint range — an off-day in another
  // sprint/month carries no dot (req: "chỉ hiện ngày off trong sprint").
  const offByDate = new Map(
    (daysOff ?? [])
      .filter((d) => !sprintRange || (d.date >= sprintRange.start && d.date <= sprintRange.end))
      .map((d) => [d.date, d.half ?? 'all'] as const)
  )

  useEffect(() => {
    gridRef.current?.focus()
  }, [])

  const disabled = (iso: string) => !!((min && iso < min) || (max && iso > max))

  const moveFocus = (days: number) => {
    const next = shiftISO(focus, days)
    setFocus(next)
    const { y, m } = ymOf(next)
    if (y !== view.y || m !== view.m) setView({ y, m })
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-7) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(7) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!disabled(focus)) onSelect(focus)
    }
  }

  const first = new Date(view.y, view.m, 1)
  const offset = (first.getDay() + 6) % 7 // Monday-first
  const cells: { iso: string; day: number; out: boolean; weekend: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const dt = new Date(view.y, view.m, 1 - offset + i)
    const dow = dt.getDay()
    cells.push({
      iso: isoYMD(dt.getFullYear(), dt.getMonth(), dt.getDate()),
      day: dt.getDate(),
      out: dt.getMonth() !== view.m,
      weekend: dow === 0 || dow === 6,
    })
  }

  const stepMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })

  return (
    <div
      ref={gridRef}
      tabIndex={0}
      role="grid"
      aria-label="Choose date"
      onKeyDown={onKey}
      className="outline-none"
    >
      <div className="flex items-center justify-between px-1 mb-2">
        <button
          type="button"
          onClick={() => stepMonth(-1)}
          aria-label="Previous month"
          className="w-7 h-7 flex items-center justify-center rounded-[7px] text-ink-muted hover:bg-surface-hover hover:text-ink transition"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">
          {MONTHS[view.m]} {view.y}
        </span>
        <button
          type="button"
          onClick={() => stepMonth(1)}
          aria-label="Next month"
          className="w-7 h-7 flex items-center justify-center rounded-[7px] text-ink-muted hover:bg-surface-hover hover:text-ink transition"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {WD.map((w) => (
          <div key={w} className="h-5 text-[10px] font-medium text-ink-faint flex items-center justify-center">
            {w}
          </div>
        ))}
        {cells.map((c) => {
          const sel = c.iso === value
          const isToday = c.iso === today && !sel
          const inSprint = !!(sprintRange && c.iso >= sprintRange.start && c.iso <= sprintRange.end) && !sel
          const isFocus = c.iso === focus && !sel
          const dis = disabled(c.iso)
          const off = offByDate.get(c.iso)
          const cls = ['relative h-[30px] rounded-[8px] text-[12.5px] tabular-nums flex items-center justify-center transition']
          if (dis) cls.push('text-ink-faint opacity-30 cursor-default')
          else if (sel) cls.push('bg-accent text-white font-semibold cursor-pointer')
          else {
            cls.push('cursor-pointer hover:bg-surface-hover')
            if (inSprint) cls.push('bg-accent-soft')
            cls.push(c.out ? 'text-ink-faint opacity-40' : c.weekend ? 'text-ink-faint' : 'text-ink')
            if (isToday) cls.push('ring-[1.5px] ring-inset ring-accent')
            else if (isFocus) cls.push('ring-[1.5px] ring-inset ring-accent/40')
          }
          return (
            <button
              key={c.iso}
              type="button"
              tabIndex={-1}
              disabled={dis}
              onClick={() => { if (!dis) onSelect(c.iso) }}
              aria-label={c.iso}
              aria-selected={sel}
              className={cls.join(' ')}
            >
              {c.day}
              {off && (
                <span
                  className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full"
                  style={
                    off === 'all'
                      ? { background: sel ? '#fff' : 'var(--color-priority-high)' }
                      : {
                          background: 'linear-gradient(90deg, var(--color-priority-high) 50%, transparent 50%)',
                          boxShadow: 'inset 0 0 0 1px var(--color-priority-high)',
                        }
                  }
                  aria-hidden
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- Portal popover (positioning + outside-click/Esc + Today/Clear footer) ----
function CalendarPopover({
  anchorRef,
  value,
  onChange,
  onClose,
  min,
  max,
  sprintRange,
  daysOff,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  value: string | null
  onChange: (v: string | null) => void
  onClose: () => void
  min?: string
  max?: string
  sprintRange?: DateRange | null
  daysOff?: DayOff[]
}) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })
  // Off-days inside the sprint, listed under the grid with their time detail (req #2).
  const offs = (daysOff ?? [])
    .filter((d) => !sprintRange || (d.date >= sprintRange.start && d.date <= sprintRange.end))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const WIDTH = 248
  // Rough fallback used only on the very first pin (before the popover has laid
  // out); thereafter we measure the real rendered height so the flip-up math
  // can't clip the footer/header that the estimate omits.
  const HEIGHT = 320 + offs.length * 22

  useLayoutEffect(() => {
    const pin = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const h = popRef.current?.offsetHeight || HEIGHT
      let left = Math.min(r.left, window.innerWidth - 8 - WIDTH)
      left = Math.max(8, left)
      let top = r.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      setPos({ top, left })
    }
    pin()
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
    }
  }, [anchorRef])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current && !popRef.current.contains(t) && anchorRef.current && !anchorRef.current.contains(t)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  return createPortal(
    <div
      ref={popRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH }}
      className="z-50 bg-surface border border-border-hair rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.04)] p-3"
    >
      <CalendarGrid
        value={value}
        onSelect={(v) => { onChange(v); onClose() }}
        min={min}
        max={max}
        sprintRange={sprintRange}
        daysOff={daysOff}
      />
      {offs.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-border-hair">
          <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-faint mb-1.5">
            <span className="w-[7px] h-[7px] rounded-full" style={{ background: 'var(--color-priority-high)' }} aria-hidden />
            Days off this sprint
          </div>
          {offs.map((d) => (
            <div key={d.date} className="flex items-center gap-2 text-[12px] py-0.5">
              <span className="w-[46px] shrink-0 font-medium tabular-nums">{formatShortDate(d.date)}</span>
              <span className="text-ink-muted">{offDetail(d.half)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border-hair">
        {(() => {
          // "Today" must respect the same min/max clamp the grid enforces —
          // otherwise it's a backdoor to set a date outside the allowed range
          // (e.g. a days-off picker bounded to the sprint).
          const today = todayISO()
          const disabled = (!!min && today < min) || (!!max && today > max)
          return (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { onChange(today); onClose() }}
              className="text-[12.5px] font-medium text-accent rounded-[7px] px-2 py-1 hover:bg-surface-hover transition disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            >
              Today
            </button>
          )
        })()}
        <button
          type="button"
          onClick={() => { onChange(null); onClose() }}
          className="text-[12.5px] text-ink-muted rounded-[7px] px-2 py-1 hover:bg-surface-hover transition"
        >
          Clear
        </button>
      </div>
    </div>,
    document.body
  )
}

// ---- Task date cell (List + Board) — keeps the right-aligned trigger look ----
export function DatePickCell({
  value,
  highlight = null,
  locked = false,
  time,
  onChange,
  ariaLabel,
  sprintRange,
  daysOff,
  emptyHint,
  emptyHintHover = false,
}: {
  value: string | null
  highlight?: 'overdue' | null
  locked?: boolean
  /**
   * Optional fixed time-of-day shown after the date (e.g. "08:00" / "17:00").
   * Display-only — the stored Task.startDate / dueDate stay yyyy-mm-dd.
   */
  time?: string
  onChange: (v: string | null) => void
  ariaLabel: string
  sprintRange?: DateRange | null
  daysOff?: DayOff[]
  /**
   * Opt-in: when set and there's no value, render a "quiet dashed pill"
   * (`＋ {emptyHint}`) instead of the bare "—" — a discoverable, tappable empty
   * affordance (matches the days-off pill idiom). Collections pass "Start"/"End";
   * the sprint view omits it, so its rows keep the plain dash.
   */
  emptyHint?: string
  /**
   * Only reveal the `emptyHint` pill on row hover (needs a `group/row` ancestor).
   * Keeps dense rows (sprint List) calm; collections show the pill always.
   */
  emptyHintHover?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  // A task belongs to a sprint → shade that range + open the picker on it (shade
  // ONLY — no min/max, every date stays selectable). Explicit prop wins; otherwise
  // the range comes from SprintRangeContext.
  const ctxRange = useContext(SprintRangeContext)
  const range = sprintRange ?? ctxRange
  const date = value ? formatShortDate(value) : ''
  const label = value && time ? `${date}, ${time}` : date
  const valueCls = value
    ? highlight === 'overdue'
      ? 'text-red-500 font-medium'
      : 'text-ink-muted'
    : 'text-ink-faint'

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={locked}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!locked) setOpen((o) => !o)
        }}
        aria-label={ariaLabel}
        title={locked ? 'Computed from prerequisites. Clear Pre to edit manually.' : undefined}
        className={`group relative inline-flex items-center justify-end w-full h-8 px-2 rounded-md border border-transparent transition ${valueCls} ${
          locked ? 'cursor-default' : 'cursor-pointer hover:border-border-strong hover:bg-canvas'
        }`}
      >
        {value ? (
          <span className="text-sm whitespace-nowrap">{label}</span>
        ) : emptyHint ? (
          <span
            className={`inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11.5px] font-medium text-ink-faint group-hover:border-accent group-hover:text-accent transition ${
              emptyHintHover ? 'opacity-0 group-hover/row:opacity-100' : ''
            }`}
          >
            ＋ {emptyHint}
          </span>
        ) : (
          <span className="text-sm text-ink-faint">—</span>
        )}
      </button>
      {open && (
        <CalendarPopover
          anchorRef={ref}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
          sprintRange={range}
          daysOff={daysOff}
        />
      )}
    </>
  )
}

// ---- Input-styled field (sprint dialog + days-off draft) ----
export function DateField({
  value,
  onChange,
  placeholder = 'Pick a date',
  min,
  max,
  sprintRange,
  daysOff,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  min?: string
  max?: string
  sprintRange?: DateRange | null
  daysOff?: DayOff[]
  /** Per-context trigger style. Defaults to the dialog full-width panel look. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className={
          className ??
          'relative mt-1 w-full text-sm bg-surface border border-border rounded-[8px] px-3 py-2 text-left focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition'
        }
      >
        {value ? (
          <span className="text-ink tabular-nums">{formatShortDate(value)}</span>
        ) : (
          <span className="text-ink-faint">{placeholder}</span>
        )}
      </button>
      {open && (
        <CalendarPopover
          anchorRef={ref}
          value={value || null}
          onChange={(v) => onChange(v ?? '')}
          onClose={() => setOpen(false)}
          min={min}
          max={max}
          sprintRange={sprintRange}
          daysOff={daysOff}
        />
      )}
    </>
  )
}
