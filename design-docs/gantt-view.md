# Gantt / Timeline view

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/GanttView.tsx` (new), `app/src/App.tsx` (view toggle),
`app/src/lib.ts` (`sprintWorkdays`, `halfDayCells` — new pure helpers),
reads `computeWorkingPlan` from `app/src/db.ts`

## Purpose
A read-only, member-grouped timeline of the current sprint — "who is doing what,
on which half-days" at a glance. Answers scheduling questions the List and Board
can't: overlap, idle gaps, day-off impact, how the auto-scheduler laid the sprint out.
Modeled on a classic team Gantt sheet (rows = member tasks, columns = days split into
Sáng/Chiều), reinterpreted in plan-up's calm Cupertino language.

## User-facing behavior
- **Third view in the segmented toggle** — `List · Board · Timeline`. Persisted at
  `localStorage['plan-up:view']` alongside the other two; scoped to the selected sprint.
- **Columns = the sprint's workdays only** (weekends skipped, matching the scheduler),
  each day split into two half-day sub-columns: **AM** (Sáng) and **PM** (Chiều).
  A 2-week sprint ≈ 10 workdays × 2 = 20 columns — fits on screen, no horizontal scroll.
- **Two-row sticky header:** top row = date (`dd/MM`, spanning its two halves), bottom
  row = `AM` / `PM`. The `TV` (member) and `Task` columns are **sticky on the left**; the
  header is **sticky on top**, so labels stay visible while scrolling a long member list.
- **Rows grouped by member (TV)**, same grouping/order as the List view. Each group is a
  member header row (avatar + name) followed by one row per task. Group/parent tasks (see
  [task-groups.md](./task-groups.md)) render as a sub-header; their child tasks each get
  their own bar row beneath.
- **Cell fill (flat single color — matches the reference sheet):**
  - **Active** (the task occupies that half-day) → a single fill color (green,
    `--color-status-done` family / accent-tinted, dark-safe). No per-status encoding —
    deliberately flat for at-a-glance reading.
  - **Day-off** → pink/red tint. A full off-day fills both S and C; a half off-day fills
    only its half (AM or PM), straight from `member.daysOff`.
  - **No work** (task not active, not a day-off) → empty / faint hairline cell.
- **Legend** above the grid: `Active · Day off · No work` (mirrors the reference's
  Task / Nghỉ / Không có việc).
- **Today marker** — a thin accent vertical line on the current day's column (only when
  today falls inside the sprint range).
- **Read-only.** No drag-to-reschedule. Bars are a pure projection of the auto-scheduler;
  all editing (effort, dates, prereqs, status) stays in the List view. Clicking a task
  row may highlight/scroll it (nice-to-have, not required for v1).
- **Search** dims/filters task rows by title, consistent with the other views
  (see [search-and-keyboard.md](./search-and-keyboard.md)).

## Data
**No schema change. No new fields. Reads only.** The view derives everything from data
that already exists:
- Each task's span comes from `computeWorkingPlan(task, …)` →
  `{ startDate, dueDate, startTime, endTime }` at half-day precision
  (`0` = 08:00, `0.5` = noon, `1` = 17:00 — see [scheduling.md](./scheduling.md)).
- Day-off cells come from `member.daysOff` (`{ date, half? }[]` — see
  [members-and-days-off.md](./members-and-days-off.md)).
- Sprint `startDate` / `endDate` define the column range.

## Implementation
- **`sprintWorkdays(startDate, endDate)`** (new, `lib.ts`, pure) — returns the ordered
  list of working dates in `[start, end]`, weekends excluded. Drives the columns.
- **`halfDayCells(task, workdays, daysOff)`** (new, `lib.ts`, pure) — returns, for each
  `(date, half)` pair, one of `'active' | 'off' | 'empty'`:
  - `off` if `daysOff` covers that date+half (full off-day → both halves).
  - `active` if the half falls within `[startDate+startFrac, dueDate+endFrac]`.
  - `empty` otherwise.
  Unit-tested independently of React, like `parsePrereqSeqs` /
  `daysOffInRange` ([dependencies.md](./dependencies.md), members doc).
- **`GanttView.tsx`** (new) — renders **Approach A: a single CSS Grid**:
  `gridTemplateColumns: [TV] [Task] repeat(2 × workdays, minmax(…, 1fr))`. Sticky left
  panes and sticky header via `position: sticky` (z-index layering for the top-left
  corner). Reuses member-grouping + `STATUS_META`/avatar helpers from `SprintView.tsx`;
  colors via existing CSS-var tokens so dark mode is automatic.
- **`App.tsx`** — extend `ViewMode` to `'list' | 'board' | 'timeline'`, add the
  `Timeline` segment (lucide icon, e.g. `GanttChartSquare`) to `ViewToggle`, and render
  `<GanttView … />` in the main switch. Pass the current sprint's `startDate`/`endDate`,
  `tasks`, `projectId`, and `search` (same props shape as the other views).

## Rules & edge cases
- **Read-only by design** — the timeline never mutates tasks; it's a projection of the
  scheduler, so it can't drift from List/Board. (Drag-to-reschedule is explicitly
  deferred; it would fight the "set effort → dates compute" model.)
- **Weekends excluded** from columns to match the scheduler (which contributes 0 on
  Sat/Sun). A task spanning a weekend simply shows no cells on those (absent) days.
- **Manual-date tasks** (no effort, no prereqs) still render — their span is whatever
  `computeWorkingPlan` returns from the manual `startDate`/`dueDate`.
- **Tasks partly outside the sprint range** clip to the visible columns (only in-range
  half-days render).
- **Parent/group tasks**: a parent is a container (excluded from member counts per
  [task-groups.md](./task-groups.md)); render it as a group sub-header and show each child
  task's bar, rather than a synthetic rolled-up bar.
- Active view persisted at `localStorage['plan-up:view']` (now accepts `'timeline'`).

## Future / open questions
- **Status-colored cells** — the flat single fill was chosen for v1; encoding status
  (todo grey / in-progress blue / done green) is a later opt-in.
- **Project-wide / scrollable range** — v1 is per-sprint; an all-sprints horizontally
  scrollable timeline is the natural expansion.
- **Drag-to-reschedule** — deferred; would require converting a drag into a manual
  `startDate` + clearing the effort-lock, then recomputing dependents.
- **Click a bar → jump to / highlight the task** in List view (nice-to-have).
- **Conflict surfacing** — overlapping bars for a double-booked member could reuse the
  amber `⚠` from [conflict-warning.md](./conflict-warning.md).
