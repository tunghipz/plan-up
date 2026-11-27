/**
 * Pure date math for the collection List used as an event calendar
 * (design-docs/collections.md "List cho lịch event"): the merged date label,
 * the date-derived "When" state, overlaps, days with no event, and month
 * grouping. Dates are `yyyy-mm-dd` strings; all arithmetic is in UTC days so
 * no timezone can shift a date. No React, no Dexie.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_MS = 86_400_000

/** An event this long (or longer) is a backdrop ("Hành trình sự kiện" all month): pinned, never an overlap. */
export const LONG_RUNNING_DAYS = 20

export const dayNum = (iso: string): number =>
  Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS)
export const isoOfDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)
export const isWeekendDay = (n: number): boolean => {
  const wd = new Date(n * DAY_MS).getUTCDay()
  return wd === 0 || wd === 6
}

/** Inclusive length in days; a missing end counts as a 1-day item. */
export function rangeDays(start: string, end: string | null): number {
  return Math.max(1, dayNum(end ?? start) - dayNum(start) + 1)
}

const short = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`

/**
 * The merged date cell: `Dec 1 – 3`, `Nov 28 – Dec 3`, `◆ Dec 7` (1 day),
 * `Dec 1 – …` (no end yet). Null when there is no start.
 */
export function formatRange(start: string | null, end: string | null): string | null {
  if (!start) return null
  if (!end) return `${short(start)} – …`
  if (end === start) return `◆ ${short(start)}`
  if (end.slice(0, 7) === start.slice(0, 7)) return `${short(start)} – ${+end.slice(8, 10)}`
  return `${short(start)} – ${short(end)}`
}

/** `3 days` / `1 day` under the merged label; null without a start. */
export function formatLength(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const n = rangeDays(start, end)
  return n === 1 ? '1 day' : `${n} days`
}

export type EventTiming = { kind: 'past' | 'live' | 'soon'; label: string }

/** The "When" column — derived from the dates and today, never stored. */
export function eventTiming(start: string | null, end: string | null, today: string): EventTiming | null {
  if (!start) return null
  const s = dayNum(start)
  const e = dayNum(end ?? start)
  const t = dayNum(today)
  if (e < t) return { kind: 'past', label: 'Done' }
  if (s <= t) {
    const left = e - t
    return { kind: 'live', label: left === 0 ? 'Ends today' : `${left + 1} days left` }
  }
  const n = s - t
  return { kind: 'soon', label: n === 1 ? 'Starts tomorrow' : `Starts in ${n} days` }
}

type Dated = { id: string; title: string; startDate: string | null; dueDate: string | null }

const span = (t: Dated): [number, number] | null =>
  t.startDate ? [dayNum(t.startDate), dayNum(t.dueDate ?? t.startDate)] : null
const isLong = (t: Dated) => !!t.startDate && rangeDays(t.startDate, t.dueDate) >= LONG_RUNNING_DAYS
export const isLongRunning = (t: Dated): boolean => isLong(t)

/**
 * id → titles of the other items sharing at least one day with it. Long-running
 * backdrops and undated items take no part. O(n²) over one collection's items
 * (tens), fine.
 */
export function overlapsById<T extends Dated>(items: T[], titleOf: (t: T) => string): Map<string, string[]> {
  const dated = items.filter((t) => t.startDate && !isLong(t)).map((t) => ({ t, r: span(t)! }))
  const out = new Map<string, string[]>()
  for (const a of dated) {
    const hits: string[] = []
    for (const b of dated) {
      if (a === b) continue
      if (a.r[0] <= b.r[1] && b.r[0] <= a.r[1]) hits.push(titleOf(b.t))
    }
    if (hits.length) out.set(a.t.id, hits)
  }
  return out
}

/** Runs of days in `[from, to]` with no (non-backdrop) event running, as `[start, end]` isos. */
export function freeRuns(items: Dated[], from: string, to: string): [string, string][] {
  const covered = new Set<number>()
  for (const t of items) {
    if (isLong(t)) continue
    const r = span(t)
    if (r) for (let d = r[0]; d <= r[1]; d++) covered.add(d)
  }
  const out: [string, string][] = []
  const lo = dayNum(from)
  const hi = dayNum(to)
  let run: number | null = null
  for (let d = lo; d <= hi + 1; d++) {
    const free = d <= hi && !covered.has(d)
    if (free && run === null) run = d
    if (!free && run !== null) {
      out.push([isoOfDay(run), isoOfDay(d - 1)])
      run = null
    }
  }
  return out
}

/** `yyyy-mm` → first/last day + "December 2026". */
export function monthBounds(key: string): { start: string; end: string; label: string } {
  const y = +key.slice(0, 4)
  const m = +key.slice(5, 7)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${key}-01`, end: `${key}-${String(last).padStart(2, '0')}`, label: `${MONTH_LONG[m - 1]} ${y}` }
}

/** Whole months spanning every dated item (Group by Table's track window); null when none is dated. */
export function windowFor(items: Dated[]): { start: string; end: string } | null {
  let lo: string | null = null
  let hi: string | null = null
  for (const t of items) {
    if (!t.startDate) continue
    const e = t.dueDate ?? t.startDate
    if (!lo || t.startDate < lo) lo = t.startDate
    if (!hi || e > hi) hi = e
  }
  if (!lo || !hi) return null
  return { start: `${lo.slice(0, 7)}-01`, end: monthBounds(hi.slice(0, 7)).end }
}
