import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar } from 'lucide-react'
import { db, setMemberDaysOff, PALETTE, type Member } from './db'
import { formatShortDate } from './lib'

/**
 * Shared member controls used by both the Sprint group header and the
 * project settings page, so the two surfaces can never drift.
 */

/** Plain colored avatar (initial). */
export function Avatar({ member }: { member: Member }) {
  return (
    <span
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 ring-2 ring-canvas shadow-[0_0_0_1px_rgba(9,30,66,0.13)]"
      style={{ background: member.color }}
      title={member.name}
    >
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Days off as effective days — a half-day counts 0.5 (matches scheduler). */
export function effectiveDaysOff(days: { half?: 'am' | 'pm' }[]): number {
  return days.reduce((s, d) => s + (d.half ? 0.5 : 1), 0)
}

/**
 * Off-days falling within an inclusive [start, end] date range (yyyy-mm-dd
 * lexical compare). Used to scope the sprint-view days-off control to the
 * sprint being viewed; settings passes no range and sees the full list.
 * See design-docs/members-and-days-off.md.
 */
export function daysOffInRange<T extends { date: string }>(
  days: T[],
  start: string,
  end: string
): T[] {
  return days.filter((d) => d.date >= start && d.date <= end)
}

/** Trim a day count for display: 2 → "2", 1.5 → "1.5". */
export function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * A row of palette swatches. The currently-selected color gets a ring.
 * Generic so it serves both members and projects.
 */
export function ColorSwatchRow({
  value,
  onPick,
}: {
  value: string | undefined
  onPick: (c: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {PALETTE.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            aria-label={`Pick color ${c}`}
            aria-pressed={active}
            title={c}
            className={`w-5 h-5 rounded-full transition ${
              active
                ? 'ring-2 ring-offset-2 ring-offset-surface ring-ink/45'
                : 'opacity-80 hover:opacity-100 hover:scale-110'
            }`}
            style={{ background: c }}
          />
        )
      })}
    </div>
  )
}

/**
 * Quiet color control: a single dot of the member's current color; click opens
 * a small palette popover. Color is secondary here (the constitution treats it
 * as deterministic), so it stays collapsed instead of an always-on swatch row.
 */
export function MemberColorDot({ member }: { member: Member }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Member color"
        title="Change color"
        className="block w-[18px] h-[18px] rounded-full transition hover:scale-110"
        style={{ background: member.color, boxShadow: '0 0 0 1px rgba(0,0,0,0.10)' }}
      />
      {open && (
        <div className="absolute right-0 top-7 z-20 bg-surface border border-border-hair rounded-[12px] shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-2">
          <ColorSwatchRow
            value={member.color}
            onPick={(c) => {
              void db.members.update(member.id, { color: c })
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Input-styled date picker. Shows formatted dd/mm/yy and opens the native
 * picker on click. `color-scheme` (set globally) themes the picker popup.
 */
function DateField({
  value,
  onChange,
  placeholder = 'dd/mm/yy',
  min,
  max,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Optional inclusive bounds for the native date picker (sprint-scoped entry). */
  min?: string
  max?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const open = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = ref.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        /* fall through */
      }
    }
    el.focus()
    el.click()
  }
  return (
    <button
      type="button"
      onClick={open}
      className="relative flex-1 text-sm bg-canvas border border-border rounded px-2 py-1 text-left h-7 focus:border-accent outline-none"
    >
      {value ? (
        <span className="text-ink tabular-nums font-mono">
          {formatShortDate(value)}
        </span>
      ) : (
        <span className="text-ink-faint">{placeholder}</span>
      )}
      <input
        ref={ref}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
    </button>
  )
}

/**
 * Calendar button on a member. Opens a popover where the manager picks days
 * the member is off (vacation, holidays). Weekends are already implicit; this
 * is only the extra off-days. Saving recomputes every task assigned to this
 * member (and forward through their deps).
 */
export function MemberDaysOffButton({
  member,
  variant = 'header',
  range,
}: {
  member: Member
  /** 'header' = Sprint group-header chip; 'metric' = always-visible settings line. */
  variant?: 'header' | 'metric'
  /**
   * When set (sprint view), scope the list + chip + entry to this sprint's
   * inclusive date range. Settings passes no range and sees the full aggregate.
   * See design-docs/members-and-days-off.md.
   */
  range?: { start: string; end: string }
}) {
  const [open, setOpen] = useState(false)
  const [draftDate, setDraftDate] = useState('')
  const [draftHalf, setDraftHalf] = useState<'all' | 'am' | 'pm'>('all')
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Popover lives in a portal (escapes Card's overflow-hidden). We track the
  // trigger's screen position and re-pin on scroll/resize so it stays glued.
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 })

  useEffect(() => {
    if (!open) return
    const pin = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) {
        setPos({
          top: rect.bottom + 4,
          right: Math.max(8, window.innerWidth - rect.right),
        })
      }
    }
    pin()
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popRef.current && !popRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('scroll', pin, true)
    window.addEventListener('resize', pin)
    document.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('scroll', pin, true)
      window.removeEventListener('resize', pin)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  // Full list drives mutations (date-keyed); the sprint view only displays and
  // counts the subset within its range. Out-of-range days stay untouched.
  const days = member.daysOff ?? []
  const visibleDays = range
    ? daysOffInRange(days, range.start, range.end)
    : days
  const count = visibleDays.length
  const effDays = effectiveDaysOff(visibleDays)
  const offLabel = effDays === 1 ? '1 day off' : `${fmtDays(effDays)} days off`

  const updateOne = async (date: string, half: 'all' | 'am' | 'pm') => {
    const next = days.filter((d) => d.date !== date)
    next.push(half === 'all' ? { date } : { date, half })
    await setMemberDaysOff(member.id, next)
  }
  const removeDay = async (date: string) => {
    await setMemberDaysOff(
      member.id,
      days.filter((d) => d.date !== date)
    )
  }
  const addDraft = async () => {
    if (!draftDate) return
    // Defensive: the picker is range-clamped, but never let a scoped view add
    // an off-day outside its sprint.
    if (range && (draftDate < range.start || draftDate > range.end)) return
    await updateOne(draftDate, draftHalf)
    setDraftDate('')
    setDraftHalf('all')
  }

  return (
    <>
      {variant === 'metric' ? (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={`inline-flex items-center gap-1.5 transition text-[12px] ${
            count > 0 ? 'text-ink-muted' : 'text-ink-faint'
          } hover:text-ink`}
          title={count > 0 ? 'Click to edit days off' : 'Set days off'}
          aria-label="Days off"
        >
          <Calendar size={13} />
          <span className="whitespace-nowrap">
            {count > 0
              ? offLabel
              : range
                ? 'No days off this sprint'
                : 'No days off'}
          </span>
        </button>
      ) : (
        <button
          ref={btnRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={`inline-flex items-center gap-0.5 transition text-sm ${
            count > 0
              ? 'text-ink opacity-100'
              : 'text-ink-faint opacity-0 group-hover/card:opacity-100'
          } hover:text-ink`}
          title={
            count > 0
              ? `${fmtDays(effDays)} day${effDays === 1 ? '' : 's'} off — click to edit`
              : 'Set days off'
          }
          aria-label="Days off"
        >
          <Calendar size={14} />
          {count > 0 && (
            <span className="text-[11px] font-medium whitespace-nowrap">
              {fmtDays(effDays)}d off
            </span>
          )}
        </button>
      )}
      {open && createPortal(
        <div
          ref={popRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-72 bg-surface border border-border-hair rounded-[14px] shadow-[0_10px_36px_rgba(0,0,0,0.18)] p-2"
        >
          <div className="text-[11px] tracking-normal text-ink-faint px-1 pb-1.5">
            Days off — {member.name}
          </div>
          {visibleDays.length === 0 && (
            <div className="text-sm text-ink-faint px-1 pb-1.5">
              {range ? 'None this sprint. ' : 'None. '}Weekends are already off.
            </div>
          )}
          {visibleDays.map((d) => (
            <div
              key={d.date}
              className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-surface-hover group/day"
            >
              <span className="text-sm text-ink tabular-nums w-16 shrink-0">
                {formatShortDate(d.date)}
              </span>
              <select
                value={d.half ?? 'all'}
                onChange={(e) =>
                  updateOne(d.date, e.target.value as 'all' | 'am' | 'pm')
                }
                className="flex-1 text-sm bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">Off all day</option>
                <option value="am">AM off (morning)</option>
                <option value="pm">PM off (afternoon)</option>
              </select>
              <button
                onClick={() => removeDay(d.date)}
                className="text-ink-faint hover:text-red-500 opacity-0 group-hover/day:opacity-100 transition"
                aria-label={`Remove ${d.date}`}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="border-t border-border mt-1 pt-2 space-y-1.5">
            <div className="flex gap-2">
              <DateField
                value={draftDate}
                onChange={setDraftDate}
                placeholder="dd/mm/yy"
                min={range?.start}
                max={range?.end}
              />
              <select
                value={draftHalf}
                onChange={(e) =>
                  setDraftHalf(e.target.value as 'all' | 'am' | 'pm')
                }
                className="text-sm bg-canvas border border-border rounded px-1.5 py-1 outline-none focus:border-accent cursor-pointer"
              >
                <option value="all">All</option>
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <button
                onClick={addDraft}
                disabled={!draftDate}
                className="text-sm px-2 py-1 rounded bg-accent text-white disabled:opacity-40"
              >
                Add
              </button>
            </div>
            <div className="text-[10px] text-ink-faint px-1">
              Half-day off counts as 0.5 day toward effort.
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
