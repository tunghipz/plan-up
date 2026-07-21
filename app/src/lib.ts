import { useEffect, useState } from 'react'
import type { Status, Priority, LoggableField, Sprint, Task } from './db'

const MS = 86400_000

/**
 * Flatten the on-screen member lanes into one top-to-bottom task list, matching
 * exactly what the user sees row-by-row. Each `card` is a lane's tasks already
 * sorted in display order (member lanes in lane order, then the Unassigned
 * lane); within a card a group head is immediately followed by its children
 * (same nesting `TaskTable` renders). A child whose parent isn't in its own card
 * is treated as top-level. Used so bulk "Chain prereqs" links tasks in the order
 * displayed, not the raw DB array order. See design-docs/dependencies.md.
 */
export function flattenDisplayOrder(cards: Task[][]): Task[] {
  const flat: Task[] = []
  for (const cardTasks of cards) {
    const idSet = new Set(cardTasks.map((t) => t.id))
    const childrenByParent = new Map<string, Task[]>()
    for (const t of cardTasks) {
      if (t.parentId && idSet.has(t.parentId)) {
        const arr = childrenByParent.get(t.parentId) ?? []
        arr.push(t)
        childrenByParent.set(t.parentId, arr)
      }
    }
    const isChild = (t: Task) => !!(t.parentId && idSet.has(t.parentId))
    for (const t of cardTasks.filter((x) => !isChild(x))) {
      flat.push(t)
      const kids = childrenByParent.get(t.id)
      if (kids) flat.push(...kids)
    }
  }
  return flat
}

/**
 * localStorage that never throws. `setItem` raises QuotaExceededError in Safari
 * private mode / when storage is full, and `getItem` can throw in locked-down
 * embeddings — either one otherwise crashes a click handler or the very first
 * render. UI prefs (selection, view mode, sidebar width, collapse state) are
 * non-critical, so persistence here is best-effort: on failure we no-op and the
 * app keeps working with in-memory state.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore — storage full or unavailable */
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

/**
 * Whole-day signed difference between `dateStr` (a `yyyy-mm-dd` calendar date)
 * and today, in the user's LOCAL timezone. Parse the date by components — NOT
 * `new Date(dateStr)`, which reads `yyyy-mm-dd` as UTC midnight and then drifts
 * a full day in UTC-negative zones when compared against a local-midnight
 * `today`. Mirrors the component-parse idiom used by `dayIndex`.
 */
export function dayDiff(dateStr: string): number {
  const a = new Date()
  a.setHours(0, 0, 0, 0)
  const [y, m, d] = dateStr.split('-').map(Number)
  const b = new Date(y, m - 1, d)
  return Math.round((b.getTime() - a.getTime()) / MS)
}

/**
 * First user-perceived character (grapheme) of a string, after trimming.
 * Uses `Intl.Segmenter` so an emoji avatar keeps ZWJ sequences (👨‍👩‍👧), flags,
 * and skin-tone modifiers intact — a naive `[0]` / `maxLength=2` would split them
 * into mojibake. Returns '' for blank input. See design-docs/member-avatars.md.
 */
export function firstGrapheme(str: string): string {
  const s = (str ?? '').trim()
  if (!s) return ''
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const part of seg.segment(s)) return part.segment
  }
  return Array.from(s)[0] ?? ''
}

// (dd/mm/yy padding helper removed in v2 — dates now render as `MMM d`.)
export const MON = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Format as `MMM d` (Cupertino DNA) — e.g. "May 19". Locale-independent
 * (fixed English month abbreviations) so it reads the same on every machine. */
export function formatShortDate(dateStr: string): string {
  // Read the y-m-d components directly. `new Date(dateStr)` parses as UTC
  // midnight, so `.getMonth()/.getDate()` (local) render the PREVIOUS day in
  // UTC-negative zones — an off-by-one on every date the app displays.
  const [, m, d] = dateStr.split('-').map(Number)
  return `${MON[m - 1]} ${d}`
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
const MAX_PREREQ_RANGE = 1000
export function parsePrereqSeqs(input: string): number[] {
  const out = new Set<number>()
  for (const token of input.split(/[,\s]+/)) {
    if (!token) continue
    const range = token.match(/^(\d+)[-–—](\d+)$/)
    if (range) {
      let a = parseInt(range[1], 10)
      let b = parseInt(range[2], 10)
      if (a > b) [a, b] = [b, a]
      // Cap the expanded width so a typo like "1-999999999" can't freeze the tab
      // building a giant Set. No real project has thousands of prereq numbers.
      if (b - a > MAX_PREREQ_RANGE) continue
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
/** Sprint range as `MMM d → MMM d` (arrow, month on both sides) — e.g.
 * "May 18 → May 31". The month repeats even within one month so the start→end
 * direction reads at a glance. Locale-independent (fixed month abbreviations). */
export function formatSprintRange(start: string, end: string): string {
  return `${formatShortDate(start)} → ${formatShortDate(end)}`
}

// ──────────────────────────────────────────────────────────────────────────
// Sprint cadence — Monday-locked start + fixed 2-week duration.
// Single source of truth for default sprint dates, shared by NewSprintDialog
// and db.seedFresh so the "every sprint starts Monday" invariant can't drift.
// Dates are parsed at UTC midnight (`T00:00:00Z` + getUTC*) to dodge the local
// DST / midnight off-by-one. ISO week starts Monday. See sprint-cadence.md.
// ──────────────────────────────────────────────────────────────────────────
const SPRINT_LEN_DAYS = 14 // start + 13 → a 14-day, Mon→Sun sprint

/** Today as a local-component `yyyy-mm-dd` (NOT the UTC slice — that renders the
 * previous day in UTC-negative zones). The one place "local today" is computed. */
export function todayLocalISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** End date of a sprint that starts on `startDate` — always `start + 13` (a Sunday). */
export function sprintEndForStart(startDate: string): string {
  const e = new Date(startDate + 'T00:00:00Z')
  e.setUTCDate(e.getUTCDate() + (SPRINT_LEN_DAYS - 1))
  return e.toISOString().slice(0, 10)
}

export type SprintTemporalState = 'upcoming' | 'progress' | 'past'

/** A sprint's state relative to `today` (a local `yyyy-mm-dd`), derived from its locked
 * window. ISO date strings compare chronologically, so plain `<`/`>` is correct. The
 * window is inclusive on both ends (Mon..Sun). Drives the row state glyph — see sprints.md. */
export function sprintTemporalState(
  startDate: string,
  endDate: string,
  today: string = todayLocalISO(),
): SprintTemporalState {
  if (today < startDate) return 'upcoming'
  if (today > endDate) return 'past'
  return 'progress'
}

/** Whole days from `fromISO` to `toISO` (both `yyyy-mm-dd`), UTC-anchored so DST
 * never shifts the count. Positive when `toISO` is later. Pure (unlike `dayDiff`,
 * which reads the live clock) so the expiry signal is testable with a fixed today. */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(fromISO + 'T00:00:00Z')
  const b = Date.parse(toISO + 'T00:00:00Z')
  return Math.round((b - a) / MS)
}

/** The four "sprint is lapsing / has lapsed" signals surfaced in the sprint header
 * banner + sidebar dot (see design-docs/sprint-expiry-signal.md):
 *   ended-open        past, still-open work, a next sprint exists → offer rollover
 *   ended-open-nonext past, still-open work, NO next sprint yet   → offer create+carry
 *   ended-done        past, everything done                       → offer go-to/create next
 *   ending-soon       in progress, ends today or tomorrow         → gentle heads-up
 * `openCount` = unfinished LEAF tasks (containers excluded, matches rollover counting). */
export type SprintExpiryKind =
  | 'ended-open'
  | 'ended-open-nonext'
  | 'ended-done'
  | 'ending-soon'

export interface SprintExpiry {
  kind: SprintExpiryKind
  /** today − endDate, ≥1 for a lapsed sprint (0 otherwise). */
  endedDays: number
  /** endDate − today, 0 (ends today) or 1 (tomorrow) for `ending-soon` (0 otherwise). */
  endsInDays: number
}

/** Classify a sprint's expiry signal, or `null` when there's nothing to surface
 * (mid-sprint with time left, or an upcoming sprint). Pure — pass `today` +
 * `openCount` + `hasNext` so it's unit-testable and never reads the clock. */
export function sprintExpirySignal(
  startDate: string,
  endDate: string,
  today: string,
  openCount: number,
  hasNext: boolean,
): SprintExpiry | null {
  const state = sprintTemporalState(startDate, endDate, today)
  if (state === 'past') {
    const endedDays = daysBetween(endDate, today)
    if (openCount > 0) {
      return { kind: hasNext ? 'ended-open' : 'ended-open-nonext', endedDays, endsInDays: 0 }
    }
    return { kind: 'ended-done', endedDays, endsInDays: 0 }
  }
  if (state === 'progress') {
    const endsInDays = daysBetween(today, endDate)
    if (endsInDays <= 1) return { kind: 'ending-soon', endedDays: 0, endsInDays }
  }
  return null
}

/** Snap a `yyyy-mm-dd` back to the Monday of its ISO week (Monday unchanged). */
export function snapToMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const delta = (d.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - delta)
  return d.toISOString().slice(0, 10)
}

/** First Monday on or after a `yyyy-mm-dd` (returns it unchanged if Monday). */
export function nextMondayOnOrAfter(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  const delta = (8 - d.getUTCDay()) % 7 // days until next Monday; 0 if Monday
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * Default `{ startDate, endDate }` for a new 2-week sprint, start locked to a
 * Monday. With a prior sprint → the first Monday after its end (back-to-back;
 * forward-snapped so a legacy mid-week end never overlaps). Otherwise → the
 * current week's Monday. End is always start + 13 days (a Sunday).
 */
export function defaultSprintDates(
  lastEndDate: string | null,
  todayStr: string
): { startDate: string; endDate: string } {
  const thisWeek = snapToMonday(todayStr)
  let startDate: string
  if (lastEndDate) {
    const d = new Date(lastEndDate + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1) // day after the last sprint ends
    const afterLast = nextMondayOnOrAfter(d.toISOString().slice(0, 10))
    // Clamp to the current week so a stale/long-ago last sprint never defaults
    // the new one into the past (ISO strings compare chronologically).
    startDate = afterLast > thisWeek ? afterLast : thisWeek
  } else {
    startDate = thisWeek
  }
  return { startDate, endDate: sprintEndForStart(startDate) }
}

/** `n` consecutive Mondays starting at `fromMonday` (`yyyy-mm-dd`), a week apart. */
export function upcomingMondays(fromMonday: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(fromMonday + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 7)
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Sprint archive — active-flow helpers (see design-docs/sprint-archive.md).
// `sprints` is assumed in startDate order (how the app queries them). Archived
// sprints (`archivedAt != null`) are excluded from the active flow.
// ──────────────────────────────────────────────────────────────────────────

/** The last non-archived sprint by order (for back-to-back defaults), or null. */
export function latestActiveSprint(sprints: Sprint[]): Sprint | null {
  for (let i = sprints.length - 1; i >= 0; i--) {
    if (sprints[i].archivedAt == null) return sprints[i]
  }
  return null
}

/** Next `Sprint N` number — past the highest number across ALL sprints (active
 * or archived) so a number is never reused. Falls back to count+1 if no name
 * matches `Sprint <n>`. */
export function nextSprintNumber(sprints: Sprint[]): number {
  let max = 0
  for (const s of sprints) {
    const m = s.name.match(/Sprint\s+(\d+)/i)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max > 0 ? max + 1 : sprints.length + 1
}

/** Which sprint to auto-select: the latest active one, else the latest overall
 * (never blank when sprints exist), else null. Returns the sprint id. */
export function sprintToSelect(sprints: Sprint[]): string | null {
  if (sprints.length === 0) return null
  return (latestActiveSprint(sprints) ?? sprints[sprints.length - 1]).id
}

// ──────────────────────────────────────────────────────────────────────────
// Change-log labels + time formatting (see design-docs/task-change-log.md).
// Label maps live here (the shared pure-utils module) rather than being moved
// out of SprintView's STATUS_META — that constant is used by SprintView,
// BoardView and GanttView and carries theme fields irrelevant to the log.
// ──────────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'None',
}

export const FIELD_LABEL: Record<LoggableField, string> = {
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  assigneeId: 'Assignee',
  startDate: 'Start',
  dueDate: 'Due',
  estimate: 'Effort',
  dependsOn: 'Prereqs',
}

/**
 * "just now" / "Xm ago" / "Xh ago" / "Xd ago", flipping to an absolute
 * `MMM d` date past 7 days. `now` is injectable so boundary tests are
 * deterministic (the older dayDiff hardcodes new Date() and can't be tested so).
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const mins = Math.floor(Math.max(0, now - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days <= 7) return `${days}d ago`
  const d = new Date(ts)
  return `${MON[d.getMonth()]} ${d.getDate()}`
}

/** Absolute `dd/mm HH:mm` for an entry's hover title. */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ──────────────────────────────────────────────────────────────────────────
// Gantt / Timeline view helpers (pure — see design-docs/gantt-view.md)
// ──────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────
// Collection Calendar — pure helpers (see design-docs/collections.md)
// idx = số ngày kể từ epoch theo UTC, để so sánh & cộng ngày không lệch TZ.
// ──────────────────────────────────────────────────────────────────────────

export function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}
function dateFromIndex(i: number): string {
  return new Date(i * 86_400_000).toISOString().slice(0, 10)
}

export interface MonthCell {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
}
export interface MonthWeek {
  startIdx: number
  cells: MonthCell[]
}
export interface MonthGrid {
  year: number
  month0: number
  weeks: MonthWeek[]
  gridStart: number
  gridEnd: number
}

/** Lưới tháng Mon-start, số tuần động (5–6) đủ phủ tháng. */
export function buildMonthGrid(year: number, month0: number, todayStr: string): MonthGrid {
  const firstIdx = Math.floor(Date.UTC(year, month0, 1) / 86_400_000)
  const dow = (new Date(firstIdx * 86_400_000).getUTCDay() + 6) % 7 // Mon=0
  const gridStart = firstIdx - dow
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const weekCount = Math.ceil((dow + daysInMonth) / 7)
  const todayIdx = dayIndex(todayStr)
  const weeks: MonthWeek[] = []
  for (let w = 0; w < weekCount; w++) {
    const startIdx = gridStart + w * 7
    const cells: MonthCell[] = []
    for (let c = 0; c < 7; c++) {
      const idx = startIdx + c
      const d = new Date(idx * 86_400_000)
      cells.push({
        date: dateFromIndex(idx),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === month0,
        isToday: idx === todayIdx,
      })
    }
    weeks.push({ startIdx, cells })
  }
  return { year, month0, weeks, gridStart, gridEnd: gridStart + weekCount * 7 - 1 }
}

export interface CalItem {
  id: string
  /** yyyy-mm-dd inclusive. */
  start: string
  end: string
}

/**
 * Gán mỗi item một lane (hàng) cố định. Sort theo start (tie-break: dài hơn
 * trước), gán lane thấp nhất mà item cuối trên lane đó đã KẾT THÚC trước khi
 * item này bắt đầu. Item không chồng ngày → chung lane.
 */
export function assignLanes(items: CalItem[]): Map<string, number> {
  const sorted = [...items].sort((x, y) => {
    const dx = dayIndex(x.start) - dayIndex(y.start)
    if (dx !== 0) return dx
    return dayIndex(y.end) - dayIndex(x.end) // dài hơn trước
  })
  const laneEnd: number[] = [] // idx kết thúc của item cuối trên mỗi lane
  const out = new Map<string, number>()
  for (const it of sorted) {
    const a = dayIndex(it.start)
    let lane = 0
    while (lane < laneEnd.length && laneEnd[lane] >= a) lane++
    out.set(it.id, lane)
    laneEnd[lane] = dayIndex(it.end)
  }
  return out
}

export interface BarSegment {
  itemId: string
  weekIndex: number
  /** 1..7 */
  colStart: number
  span: number
  roundL: boolean
  roundR: boolean
  /** Cắt mép trái lưới (còn tiếp từ tháng trước). */
  leftChev: boolean
  /** Cắt mép phải lưới (còn tiếp sang tháng sau). */
  rightChev: boolean
  lane: number
}

/** Cắt mỗi item thành các đoạn theo từng tuần trong lưới tháng. */
export function computeBarSegments(
  items: CalItem[],
  grid: MonthGrid,
  lanes: Map<string, number>
): BarSegment[] {
  const out: BarSegment[] = []
  for (const it of items) {
    const a = dayIndex(it.start)
    const b = dayIndex(it.end)
    if (b < grid.gridStart || a > grid.gridEnd) continue
    grid.weeks.forEach((week, weekIndex) => {
      const wkStart = week.startIdx
      const wkEnd = wkStart + 6
      if (b < wkStart || a > wkEnd) return
      const segA = Math.max(a, wkStart)
      const segB = Math.min(b, wkEnd)
      out.push({
        itemId: it.id,
        weekIndex,
        colStart: segA - wkStart + 1,
        span: segB - segA + 1,
        roundL: segA === a,
        roundR: segB === b,
        leftChev: segA === grid.gridStart && a < grid.gridStart,
        rightChev: segB === grid.gridEnd && b > grid.gridEnd,
        lane: lanes.get(it.id) ?? 0,
      })
    })
  }
  return out
}

export function useDarkMode() {
  // safeStorage, not raw localStorage: getItem throws in locked-down
  // embeddings and this initializer runs on the very first render.
  const [dark, setDark] = useState<boolean>(() => {
    const stored = safeStorage.get('plan-up:dark')
    if (stored !== null) return stored === '1'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    safeStorage.set('plan-up:dark', dark ? '1' : '0')
  }, [dark])

  return [dark, setDark] as const
}

/**
 * Brand theme — ZingPlay Fire (default) vs Cupertino Blue. Pure token swap:
 * the effect stamps `data-brand` on <html> and index.css does the rest
 * (design-docs/brand-theme.md). Mirrors useDarkMode (safeStorage + effect).
 */
export type BrandTheme = 'fire' | 'blue'

export function useBrandTheme() {
  const [brand, setBrand] = useState<BrandTheme>(() =>
    safeStorage.get('plan-up:brand') === 'blue' ? 'blue' : 'fire',
  )

  useEffect(() => {
    document.documentElement.dataset.brand = brand
    safeStorage.set('plan-up:brand', brand)
  }, [brand])

  return [brand, setBrand] as const
}

/**
 * Priority-tag colors — soft-tint pill, only for urgent/high (Normal/Low are
 * the silent default: no tag). ONE source for every view that renders the
 * pill (sprint list title row, rollover preview) so the tints can't drift.
 */
export const PRIORITY_TAG: Record<
  string,
  { label: string; bg: string; fg: string }
> = {
  urgent: {
    label: 'Urgent',
    bg: 'rgba(255,59,48,0.12)',
    fg: 'color-mix(in srgb, var(--color-priority-urgent) 100%, #000 22%)',
  },
  high: {
    label: 'High',
    bg: 'rgba(255,149,0,0.15)',
    fg: 'color-mix(in srgb, var(--color-priority-high) 100%, #000 22%)',
  },
}

/** Download any JSON-serialisable payload as a file (Blob + transient anchor). */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Filesystem-safe slug for a project name; falls back to "project" when empty. */
export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'project'
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

/**
 * Widen a sprint's `[start, end]` window to also cover the date span of the tasks
 * shown in it. A sprint holds tasks by `sprintId`, not by date, so a task can be due
 * before the sprint starts (overdue/carried) or after it ends; clamping the days-off
 * picker to the bare window then makes those dates unpickable. This returns the
 * inclusive window widened down to the earliest and up to the latest of `taskDates`,
 * unchanged when every date already sits inside. Pure lexical yyyy-mm-dd min/max;
 * empty/undefined dates ignored. See design-docs/members-and-days-off.md.
 */
export function daysOffWindow(
  start: string,
  end: string,
  taskDates: (string | null | undefined)[]
): { start: string; end: string } {
  let lo = start
  let hi = end
  for (const d of taskDates) {
    if (!d) continue
    if (d < lo) lo = d
    if (d > hi) hi = d
  }
  return { start: lo, end: hi }
}

/** Trim a day count for display: 2 → "2", 1.5 → "1.5". */
export function fmtDays(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** Curated emoji for a project icon (see project-icon-emoji.md) — the 15 most
 *  project-relevant glyphs, sized to exactly two rows alongside the leading "Aa"
 *  chip (8 cols × 2). Everything else is reached through the search box, which
 *  filters the shared `EMOJI` keyword set (and surfaces any pasted emoji). */
export const PROJECT_ICON_EMOJIS = [
  '🚀', '🎯', '✅', '📌', '📋', '💡', '🔥', '⭐',
  '📈', '🐛', '🔧', '🎨', '🧩', '📦', '🗂️',
]
