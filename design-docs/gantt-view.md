# Timeline view (calendar swimlanes)

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/GanttView.tsx`, `app/src/App.tsx` (view toggle),
`app/src/lib.ts` (`sprintWorkdays`), reads `computeWorkingPlan` from `app/src/db.ts`,
reuses `STATUS_META` from `app/src/SprintView.tsx` and `Avatar` from `app/src/members.tsx`

> **Redesign note (2026-06-04):** the first implementation was a dense half-day **cell
> grid** (AM/PM columns, hairline borders, zebra). That read as a spreadsheet/ledger and
> violated the Cupertino DNA (`design-system.md`: *depth not lines*, *calm*, *no heavy
> cell-grid separators*). It was torn down and rebuilt as an **Apple-Calendar-style
> swimlane** view. The old grid + its `halfDayCells` helper live in git history.

## Purpose
A calm, glanceable answer to **"when does each person's work happen this sprint?"** — the
thing List and Board can't show. Read-only: a pure projection of the auto-scheduler.

## User-facing behavior
- **Third view in the segmented toggle** — `List · Board · Timeline`. Persisted at
  `localStorage['plan-up:view']`; scoped to the selected sprint.
- **One calm calendar surface** (a single white rounded-14 card with soft shadow on the
  grey canvas — depth, not a bordered table). Inside:
  - **Sticky date header** — one column per **workday** (weekends skipped, matching the
    scheduler), each showing `MMM d` + the weekday (`Mon`…`Fri`). A skipped weekend gets a
    slightly stronger separator. Today's column tints accent.
  - **A swimlane per member** — sticky-left label (avatar + name + role), separated by
    soft hairlines + whitespace (not heavy rules).
- **Tasks are soft-tinted event blocks** (Apple-Calendar style), placed on the day axis:
  - Colored by **status** via the app's system palette (todo grey / in-progress blue /
    done green) using the same `color-mix(… 15%, transparent)` soft-tint as the List
    status pill — a soft fill + a saturated status **accent edge** + the `#id title` inside.
  - **Half-day precision** by position: a PM start offsets the block half a column; a noon
    finish ends it mid-column. No cell grid.
  - **Lane-packed** — non-overlapping tasks for one member share a row; overlapping ones
    stack. Member height grows only as needed.
  - A block whose task **continues past the window's right edge** shows a `›` caret.
- **Day-off** renders as soft-grey vertical bands in the member's lane (full day = whole
  column, half = its AM or PM half), from `member.daysOff` — **member-level**, so it shows
  even when no task spans it.
- **Off-window & unscheduled tasks** never vanish: tasks scheduled outside the sprint
  window (the scheduler routinely pushes work weeks past the sprint end) and tasks with no
  computed dates are **summarised as a count in the member label** — `↗ N later · ○ K no
  dates`. Clicking expands a chip list (each: `#id title → MMM d`, or `no dates`).
- **Today marker** — a thin continuous accent line across all lanes (only when today is in
  range).
- **Search** filters task blocks by title, consistent with the other views.

## Data
**No schema change. No new fields. Reads only.** Everything derives from existing data:
- Each task's span comes from `computeWorkingPlan(task, …)` →
  `{ startDate, dueDate, startTime, endTime }` at half-day precision
  (`startTime '13:00'` = PM start; `endTime '12:00'` = noon finish — see
  [scheduling.md](./scheduling.md)).
- Day-off bands from `member.daysOff` (`{ date, half? }[]` — see
  [members-and-days-off.md](./members-and-days-off.md)).
- Sprint `startDate` / `endDate` define the column range.

## Implementation
- **`sprintWorkdays(startDate, endDate)`** (`lib.ts`, pure, unit-tested) — ordered working
  dates in range, weekends excluded. Drives the columns.
- **`GanttView.tsx`** — one horizontally-scrollable surface (`overflow-x-auto`); the inner
  width is `MGUT + workdays·DAY`. Sticky date header (`top`) + sticky member labels
  (`left`). Per member, in a `useMemo`:
  - Each task → `computeWorkingPlan`, then classified: **in-window** (start within
    `[firstDay,lastDay]`) → an event block; **later** (start after the window, or whole
    span before it) and **no-dates** (no computed start/due) → the count buckets.
  - Block geometry: `left = startIdx·DAY (+½ if PM start)`, `right = endIdx·DAY (+½ if noon
    finish, or clamped to the window edge with a `contRight` caret)`.
  - **Greedy lane-packing**: events sorted by `left`; each joins the first lane whose last
    block ends at/before it starts, else a new lane. `rows` = lane count.
  - Day-off half-columns → soft-grey bands.
  - Soft tints reuse the app pattern: `color-mix(in srgb, var(--color-status-X) 15%,
    transparent)` bg + `color-mix(…100%, #000 22%)` text + the raw token as the accent edge.
- **`App.tsx`** — `ViewMode` includes `'timeline'`; `Timeline` segment (lucide
  `GanttChartSquare`) in `ViewToggle`; renders `<GanttView … />`.

## Rules & edge cases
- **Read-only by design** — never mutates tasks; a projection of the scheduler, so it can't
  drift from List/Board. Editing (effort/dates/prereqs/status) stays in List.
- **Weekends excluded** from columns (scheduler contributes 0 there).
- **Nothing is hidden** — every assigned task is either a block, a `later` chip, or a
  `no dates` chip. Off-window/unscheduled counts sit in the member label, expandable.
- **Parent/group tasks**: a parent is a container; it appears like any task (its own
  computed dates, usually none → `no dates`), children appear as their own blocks.
- Active view persisted at `localStorage['plan-up:view']` (accepts `'timeline'`).

## DNA check (`design-system.md`)
Depth not lines (one card + soft hairlines, no cell grid) ✓ · system status colors ✓ ·
SF tabular-nums for dates ✓ · radius ≥ 14 card / soft blocks ✓ · accent as signal (today
line, off-window chips) ✓ · calm, content breathes ✓ · dark-mode via tokens ✓.

## Future / open questions
- **Drag-to-reschedule** — deferred; would fight the "set effort → dates compute" model.
- **Click a block → open/scroll to the task** in List (nice-to-have).
- **Project-wide / scrollable range** beyond the sprint window.
- **Conflict surfacing** — a double-booked member could tint overlapping blocks.
