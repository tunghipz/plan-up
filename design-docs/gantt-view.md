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
- **Two-row sticky header:** top row = date (`dd/MM`) **with the weekday under it**
  (`Mon`…`Fri`) so the axis is orientable; bottom row = `AM` / `PM`. The `TV` (member)
  and `Task` columns are **sticky on the left**; the header is **sticky on top**, so
  labels stay visible while scrolling a long member list.
- **Weekend seam:** wherever a weekend was skipped between two adjacent columns
  (Fri → Mon), the later column gets a **stronger 2px separator** so the discontinuity is
  legible (a Fri/Mon jump doesn't read as two consecutive days).
- **Rows grouped by member (TV)**, same grouping/order as the List view. Each group is a
  member header row (avatar + name + role) followed by one row per task. Group/parent tasks
  (see [task-groups.md](./task-groups.md)) render as a sub-header; their child tasks each
  get their own bar row beneath (indented).
- **Member load roll-up:** the member header band carries a slim accent **load bar** =
  the union of that member's task spans across the sprint, so team load reads at the group
  level (discontinuous load shows as multiple segments). Pure derived; no new data.
- **Member day-off marks:** the band also shows the member's **off-days** (within the
  window) as full-height hatched-pink blocks — because off-days are member-level, this makes
  them visible even when **no task spans them** (a task-row off cell only paints inside a
  bar). Full off-day = whole column; half off-day = its AM or PM half.
- **Cell fill (flat single color — matches the reference sheet):**
  - **Active** (the task occupies that half-day) → a single green fill (dark-safe) with a
    subtle top inset highlight. **No per-status encoding** — deliberately flat. Contiguous
    runs get **rounded ends** (left cap on the first active half, right cap on the last) so
    a task reads as one segment, not loose cells.
  - **Day-off** → a **diagonal-hatched pink** fill (reads as "off", not as another status).
    A full off-day fills both AM and PM; a half off-day fills only its half, straight from
    `member.daysOff`.
  - **No work** (task not active, not a day-off) → empty cell, with a very faint **per-day
    zebra** tint to aid horizontal scanning; the interior AM/PM hairline is lighter than the
    day separator so bars pop.
- **Unscheduled tasks** (no computed dates — no effort and no prereqs) render a muted title
  plus a dashed **"no dates"** tag on a dotted baseline instead of a blank row, so an empty
  row reads as "set effort in List to schedule," not as a broken view.
- **Legend** above the grid: `Active · Day off · No work · Member load`.
- **Today marker** — a thin accent vertical line on the current day's column (only when
  today falls inside the sprint range); that day's header tints accent.
- **Long titles** are clipped to the sticky Task column (`overflow:hidden` + wrap) so they
  never bleed into the grid.
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
- **`GanttView.tsx`** (new) — **Approach A:** every visual row is its own CSS grid sharing
  one fixed column template (`[TV] [Task] repeat(2 × workdays, ${HALF_W}px)`), so columns
  align without one giant grid. Sticky left panes + sticky header via `position: sticky`
  (z-index layering for the top-left corner); the outer card is `w-fit` so it hugs the
  columns. Colors via existing CSS-var tokens so dark mode is automatic. Local helpers:
  - `weekday(date)` + a `seamSet` (built from `gapBefore`, true when a weekend was skipped)
    drive the weekday labels and the 2px seam separators.
  - Per group: each task's `computeWorkingPlan` → `halfDayCells` is flattened to a `2N`
    `CellKind[]`; `scheduled = !!startDate && !!dueDate` decides bar-cells vs the "no dates"
    affordance. Run boundaries on the flat array give the rounded segment caps.
  - `segmentsOf(union)` turns the union of a member's occupied half-days into the load
    roll-up bars rendered absolutely in the member band.
  - The `Cell` component encodes per-half border (day separator vs lighter AM/PM hairline
    vs seam), zebra tint, active fill + rounded caps, and the hatched day-off fill.
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
- **Tasks scheduled outside the sprint window** are never blank rows: a task whose span is
  entirely **after** the window shows a right-pinned chip `→ <start date>`; entirely
  **before** shows a left-pinned `<due date> ←`. A bar that's partly visible but **continues
  past an edge** gets a `›` (right) / `‹` (left) continuation caret. (The window stays the
  sprint's own dates — the scheduler routinely pushes tasks weeks past the sprint end.)
- **Tasks partly inside the sprint range** clip to the visible columns (only in-range
  half-days render) plus the continuation caret above.
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
