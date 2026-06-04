import { useEffect, useState } from 'react'
import type { DayOff } from './db'

const MS = 86400_000

function dayDiff(dateStr: string): number {
  const a = new Date()
  a.setHours(0, 0, 0, 0)
  const b = new Date(dateStr)
  b.setHours(0, 0, 0, 0)
  return Math.round((b.getTime() - a.getTime()) / MS)
}

// (dd/mm/yy padding helper removed in v2 — dates now render as `MMM d`.)
const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Format as `MMM d` (Cupertino DNA) — e.g. "May 19". Locale-independent
 * (fixed English month abbreviations) so it reads the same on every machine. */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${MON[d.getMonth()]} ${d.getDate()}`
}

export function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return formatShortDate(dateStr)
}

export function isOverdue(dateStr: string | null, isDone: boolean): boolean {
  if (!dateStr || isDone) return false
  return dayDiff(dateStr) < 0
}

/**
 * Parse a prerequisite input string into a sorted, de-duplicated list of
 * positive sequence numbers. Accepts comma/space-separated singles AND
 * inclusive ranges written `a-b` (e.g. "2-5, 8" → [2,3,4,5,8]; "5-2" → 2..5).
 * Non-numeric tokens are ignored. See design-docs/dependencies.md.
 */
export function parsePrereqSeqs(input: string): number[] {
  const out = new Set<number>()
  for (const token of input.split(/[,\s]+/)) {
    if (!token) continue
    const range = token.match(/^(\d+)[-–—](\d+)$/)
    if (range) {
      let a = parseInt(range[1], 10)
      let b = parseInt(range[2], 10)
      if (a > b) [a, b] = [b, a]
      for (let n = a; n <= b; n++) if (n > 0) out.add(n)
    } else {
      const n = parseInt(token, 10)
      if (Number.isInteger(n) && n > 0) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Collapse sequence numbers into a compact label: consecutive runs become
 * `a-b`, isolated numbers stay single, joined by ", " (e.g. [2,3,4,5,8] →
 * "2-5, 8"). Display counterpart of parsePrereqSeqs.
 */
export function formatSeqRanges(seqs: number[]): string {
  const xs = [...new Set(seqs)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < xs.length) {
    let j = i
    while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
    parts.push(j > i ? `${xs[i]}-${xs[j]}` : `${xs[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}

/** `MMM d – d` when same month, else `MMM d – MMM d`. */
export function formatSprintRange(start: string, end: string): string {
  const a = new Date(start)
  const b = new Date(end)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${MON[a.getMonth()]} ${a.getDate()} – ${b.getDate()}`
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`
}

// ──────────────────────────────────────────────────────────────────────────
// Gantt / Timeline view helpers (pure — see design-docs/gantt-view.md)
// ──────────────────────────────────────────────────────────────────────────

/** State of one half-day cell in the timeline grid. */
export type CellKind = 'active' | 'off' | 'empty'

/** A single workday column: its AM (Sáng) and PM (Chiều) cell states. */
export interface HalfDayState {
  am: CellKind
  pm: CellKind
}

/**
 * Ordered list of working dates (yyyy-mm-dd) in `[start, end]` inclusive,
 * with weekends (Sat/Sun) excluded — matching the scheduler, which
 * contributes 0 on weekends. Drives the Gantt's date columns.
 */
export function sprintWorkdays(start: string, end: string): string[] {
  const out: string[] = []
  if (!start || !end || start > end) return out
  let d = start
  let guard = 0
  while (d <= end && guard++ < 1000) {
    const day = new Date(d + 'T00:00:00Z').getUTCDay()
    if (day !== 0 && day !== 6) out.push(d)
    const nd = new Date(d + 'T00:00:00Z')
    nd.setUTCDate(nd.getUTCDate() + 1)
    d = nd.toISOString().slice(0, 10)
  }
  return out
}

/**
 * Project a task's computed span onto the workday columns as half-day cells.
 * For each workday returns `{ am, pm }` where each is:
 *   - `'off'`    — the member is off that half AND it's inside the task's span
 *                  (a full off-day covers both halves; a half off-day one).
 *   - `'active'` — inside the span and a working half.
 *   - `'empty'`  — outside the span (incl. halves trimmed by a PM-start /
 *                  noon-end boundary).
 *
 * `plan` is the resolved output of `computeWorkingPlan` (date + wall-time);
 * `startTime === '13:00'` means the start day's AM is not worked, and
 * `endTime === '12:00'` means the due day's PM is not worked. Pure and
 * unit-tested independently of React.
 */
export function halfDayCells(
  plan: {
    startDate: string | null
    dueDate: string | null
    startTime: string
    endTime: string
  },
  workdays: string[],
  daysOff: DayOff[]
): HalfDayState[] {
  // Collapse a member's off-days to one entry per date: 'full' | 'am' | 'pm'.
  const offByDate = new Map<string, 'full' | 'am' | 'pm'>()
  for (const o of daysOff) {
    if (!o.half) {
      offByDate.set(o.date, 'full')
      continue
    }
    const prev = offByDate.get(o.date)
    if (prev === undefined) offByDate.set(o.date, o.half)
    else if (prev !== o.half) offByDate.set(o.date, 'full') // am + pm = full
  }

  const { startDate, dueDate, startTime, endTime } = plan
  const startsPM = startTime === '13:00'
  const endsAM = endTime === '12:00'

  return workdays.map((date) => {
    const inSpan = !!startDate && !!dueDate && date >= startDate && date <= dueDate
    const off = offByDate.get(date)
    const cell = (half: 'am' | 'pm'): CellKind => {
      if (!inSpan) return 'empty'
      if (date === startDate && startsPM && half === 'am') return 'empty'
      if (date === dueDate && endsAM && half === 'pm') return 'empty'
      if (off === 'full' || off === half) return 'off'
      return 'active'
    }
    return { am: cell('am'), pm: cell('pm') }
  })
}

export function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const stored = localStorage.getItem('plan-up:dark')
    if (stored !== null) return stored === '1'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('plan-up:dark', dark ? '1' : '0')
  }, [dark])

  return [dark, setDark] as const
}
