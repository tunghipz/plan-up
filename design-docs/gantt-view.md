# Timeline view (calendar swimlanes)

**Status:** Implemented
**Last updated:** 2026-06-29

> **Bar drag / resize (2026-06-29):** leaf task bars can be rescheduled directly
> in Timeline. Drag the bar body to move the task to another workday; drag the
> left/right resize handles to change the start or duration. Parent summary rails,
> milestones, dependency-driven tasks, and bars clipped by the sprint window stay
> read-only and use the detail popover / "Open in List →" path.
>
> **Multi-sprint range mode (2026-06-29):** Timeline can switch from the selected
> sprint window to a manual `From` / `To` date range. Range mode shows assigned
> sprint tasks from the whole project whose computed schedule overlaps the window,
> so a user can inspect several sprint timelines at once. Visible, editable leaf bars
> can still be dragged/resized inside the selected range.
>
> **Timeline task selection + sprint move (2026-06-29):** event blocks expose a small
> selection toggle. Selecting one or more tasks shows a bottom action bar with `Move to
> sprint`, listing every active sprint in the project, including earlier sprints.
**Code:** `app/src/GanttView.tsx`, `app/src/App.tsx` (view toggle),
`app/src/lib.ts` (`sprintWorkdays`), reads `computeWorkingPlan` from `app/src/db.ts`,
reuses `STATUS_META` from `app/src/SprintView.tsx` and `Avatar` from `app/src/members.tsx`

> **Redesign note (2026-06-04):** the first implementation was a dense half-day **cell
> grid** (AM/PM columns, hairline borders, zebra). That read as a spreadsheet/ledger and
> violated the Cupertino DNA (`design-system.md`: *depth not lines*, *calm*, *no heavy
> cell-grid separators*). It was torn down and rebuilt as an **Apple-Calendar-style
> swimlane** view. The old grid + its `halfDayCells` helper live in git history.

## Purpose
A calm, glanceable answer to **"when does each person's work happen in this sprint or
date range?"** — the thing List and Board can't show. It is mostly a scheduler projection,
with direct day-level drag/resize for editable leaf tasks when scoped to one sprint.

## User-facing behavior
- **Third view in the segmented toggle** — `List · Board · Timeline`. Persisted at
  `localStorage['plan-up:view']`; scoped to the selected sprint.
- **Timeline scope control** — a compact `Sprint · Range` segmented control sits above the
  calendar. `Sprint` uses the selected sprint's start/end dates and current sprint tasks.
  `Range` reveals `From` / `To` date pickers and projects assigned tasks from all project
  sprints whose computed span overlaps that window. A `This sprint` action resets the range
  to the selected sprint dates.
- **One calm calendar surface** (a single white rounded-14 card with soft shadow on the
  grey canvas — depth, not a bordered table). Inside:
  - **Sticky date header** — one column per **workday** (weekends skipped, matching the
    scheduler), each showing `MMM d` + the weekday (`Mon`…`Fri`). A skipped weekend gets a
    slightly stronger separator. Today's column tints accent.
  - **Fluid columns** — day columns stretch to **fill the surface's full width** so a short
    sprint never leaves dead white space on the right. The column width is measured at
    runtime (`(availableWidth − labelGutter) / workdays`), clamped to a minimum so a long
    sprint still scrolls horizontally instead of squashing. The date text is sized for
    glance-readability (date `MMM d` larger than the weekday line).
  - **A swimlane per member** — sticky-left label (avatar + name + role + days-off
    control), separated by soft hairlines + whitespace (not heavy rules).
- **Parent (group) tasks render as a summary rail** — a slim status-colored bar with end
  caps spanning **earliest child start … latest child end** (the same roll-up the List group
  row shows; parents have no own dates), tinted by the children's *derived* status. Its
  children still appear as their own event blocks (in their assignees' lanes), lane-packed
  below the rail. A parent only falls to the `no dates` bucket when **none** of its children
  have computed dates.
- **Tasks are soft-tinted event blocks** (Apple-Calendar style), placed on the day axis:
  - Colored by **status** via the app's system palette (todo grey / in-progress blue /
    done green) using the same `color-mix(… 15%, transparent)` soft-tint as the List
    status pill — a soft fill + a saturated status **accent edge** + the `#id title` inside.
  - **Half-day precision** by position: a PM start offsets the block half a column; a noon
    finish ends it mid-column. No cell grid.
  - **Lane-packed** — non-overlapping tasks for one member share a row; overlapping ones
    stack. Member height grows only as needed.
  - A block whose task **continues past the window's right edge** shows a `›` caret.
- **Direct reschedule gestures**:
  - Drag the **body** of an editable task bar horizontally to move `startDate` by whole
    workday columns.
  - Drag the **left edge** to change `startDate` while keeping the right edge fixed.
  - Drag the **right edge** to change duration. For effort-driven tasks this updates
    `estimate` to the number of working days in the resized span, then recomputes dates;
    for manually-dated tasks it updates `dueDate`.
  - Edits snap to visible sprint workdays and go through `updateTask` + `recomputeDates`,
    so activity log and dependent recomputation remain consistent.
  - Range mode supports the same direct manipulation for fully visible editable leaf bars.
    Clipped bars remain read-only because the hidden edge would make the resulting span
    ambiguous.
- **Timeline selection actions**:
  - Each task event block has a compact selection toggle. Selected blocks keep a visible
    accent ring and can be selected one at a time or in batches.
  - While at least one task is selected, a bottom action bar appears with `N selected`,
    `Move to sprint`, and `Cancel`.
  - `Move to sprint` opens a searchable sprint menu with all active project sprints, not
    just the next sprint. Choosing a sprint moves every selected task that is not already
    in that sprint through the canonical `moveTaskToSprint` path, then clears selection.
- **Milestones (effort 0)** render as a **diamond** on their date (status-coloured) with a
  label, not a span — the Gantt convention. A milestone on a non-working day falls back to
  the `no dates` bucket. See [milestones.md](./milestones.md).
- **Day-off** can be edited from the member's sticky lane label using the shared
  days-off control. It renders as a faint **diagonal-hatch** band in the member's
  lane (full day = whole column, half = its AM or PM half), from
  `member.daysOff` — **member-level**, so it shows even when no task spans it.
  Where a **task bar crosses a day-off**, the bar stays one continuous block but
  the overlapping slice is overlaid with a same-status **hatch + dim "pause"** —
  connecting the off-day to the task it interrupts (the bar visibly pauses there,
  rather than the off-day being a disconnected grey band behind it). Parent
  summary rails are exempt (they only show the lane's hatch behind them).
- **Off-window & unscheduled tasks** never vanish, and off-window is split by **direction**:
  a task wholly **after** the window is `later` (`↗`, shows its start), one wholly **before**
  is `earlier` (`↙`, shows its end — when it finished). Tasks with no computed dates are
  `no dates`. All three are **summarised as counts in the member label** — `↙ N earlier ·
  ↗ M later · ○ K no dates`. Clicking expands a chip list (earlier chips first), each `#id
  title ← MMM d` / `→ MMM d` / `no dates`. The off-window chips are **soft-tinted by the
  task's status** (same palette as the in-window blocks), so a Done task off-window still
  reads green — never a generic accent.
- **Today marker** — a thin continuous accent line across all lanes (only when today is in
  range).
- **Search** filters task blocks by title, consistent with the other views.

## Data
**No schema change. No new fields.** Rendering still derives from existing data:
- Each task's span comes from `computeWorkingPlan(task, …)` →
  `{ startDate, dueDate, startTime, endTime }` at half-day precision
  (`startTime '13:00'` = PM start; `endTime '12:00'` = noon finish — see
  [scheduling.md](./scheduling.md)).
- Day-off bands from `member.daysOff` (`{ date, half? }[]` — see
  [members-and-days-off.md](./members-and-days-off.md)).
- Sprint `startDate` / `endDate` define the column range.
- In Range mode, the manual `From` / `To` values define the column range, and `App.tsx`
  passes project tasks so `GanttView` can filter to sprint-linked tasks overlapping the
  selected window.
- Timeline edits mutate existing `Task.startDate`, `Task.dueDate`, and/or `Task.estimate`.
- Moving selected tasks to another sprint mutates existing `Task.sprintId`, renumbers them
  in the target sprint, clears collection-only fields, logs the target sprint activity, and
  recomputes dates via `moveTaskToSprint`.

## Implementation
- **`sprintWorkdays(startDate, endDate)`** (`lib.ts`, pure, unit-tested) — ordered working
  dates in range, weekends excluded. Drives the columns.
- **`GanttView.tsx`** — one horizontally-scrollable surface (`overflow-x-auto`); the inner
  width is `MGUT + workdays·dayW`, where **`dayW` is computed at runtime** from the measured
  surface width (`ResizeObserver` on the scroll container): `dayW = max(MIN_DAY,
  (measuredWidth − MGUT) / N)`. Few workdays → columns widen to fill; many → falls back to
  `MIN_DAY` and the surface scrolls. Sticky date header (`top`) + sticky member labels
  (`left`). Per member, in a `useMemo` (keyed on `dayW`):
  - Each task → `computeWorkingPlan`, then classified: **in-window** (start within
    `[firstDay,lastDay]`) → an event block; **later** (start after the window, or whole
    span before it) and **no-dates** (no computed start/due) → the count buckets.
  - Block geometry: `left = startIdx·DAY (+½ if PM start)`, `right = endIdx·DAY (+½ if noon
    finish, or clamped to the window edge with a `contRight` caret)`.
  - **Greedy lane-packing, parents first**: parent summary rails are packed into the top
    lanes, then every other block packs into the lanes below them — so a group's rail always
    sits *above* its children (Gantt convention). Within each pass, events sort by `left` and
    join the first lane whose last block ends at/before they start, else a new lane.
  - Day-off half-columns → faint diagonal-hatch bands; each in-window task block also paints
    a same-status hatch+dim "pause" over any slice that overlaps a day-off (clipped inside the
    block's rounded bounds), so the bar reads as pausing on the off-day.
  - Member lane labels reuse `MemberDaysOffButton` with the selected sprint range,
    so adding/removing an off-day in Timeline updates the scheduler and the hatch
    overlay through the same write path as List/settings.
  - Soft tints reuse the app pattern: `color-mix(in srgb, var(--color-status-X) 15%,
    transparent)` bg + `color-mix(…100%, #000 22%)` text + the raw token as the accent edge.
- **Range source selection** — Sprint mode renders only the current sprint task array.
  Range mode renders project tasks with `sprintId` whose computed plan overlaps the
  selected date window. Collection-only tasks are excluded because they have no sprint
  calendar context.
- **Selection bar** — `GanttView.tsx` owns Timeline-only `selectedIds` state. Selection is
  pruned when the visible task set changes, cleared when scope/range changes, and applied
  through `moveTaskToSprint` for each selected task.
- **`App.tsx`** — `ViewMode` includes `'timeline'`; `Timeline` segment (lucide
  `GanttChartSquare`) in `ViewToggle`; renders `<GanttView … />` and passes project tasks
  for Range mode.

## Rules & edge cases
- **Editable with scheduler guards** — Timeline mutates only leaf task date fields through the
  canonical edit path. It does not directly edit parent/group summary rails, milestones,
  dependency-driven tasks, or off-window clipped bars because those positions are computed
  from other facts and would otherwise appear to "snap back".
- **Range mode edits are visible-window edits** — direct drag/resize is allowed only when
  both task edges are visible in the selected range. Bars clipped by either edge stay
  read-only.
- **Move to sprint skips no-ops** — if a selected task is already in the chosen sprint, it is
  left in place rather than renumbered.
- **Weekends excluded** from columns (scheduler contributes 0 there).
- **Nothing is hidden** — every assigned task is either a block, a `later` chip, or a
  `no dates` chip. Off-window/unscheduled counts sit in the member label, expandable.
- **Parent/group tasks**: a parent is a container with no own dates; it renders as a
  **summary rail** spanning its children's roll-up span (earliest start … latest end),
  while each child also appears as its own block. Only when *no* child has dates does the
  parent fall to the `no dates` bucket. A block that starts before the window's left edge is
  clamped to the edge with a `‹` caret (mirrors the `›` right-edge caret).
- **Snap granularity**: drag/resize snaps to whole workday columns. Half-day placement from
  the scheduler is still rendered, but direct manipulation intentionally stays day-level.
- Active view persisted at `localStorage['plan-up:view']` (accepts `'timeline'`).

## DNA check (`design-system.md`)
Depth not lines (one card + soft hairlines, no cell grid) ✓ · system status colors ✓ ·
SF tabular-nums for dates ✓ · radius ≥ 14 card / soft blocks ✓ · accent as signal (today
line, off-window chips) ✓ · calm, content breathes ✓ · dark-mode via tokens ✓.

## Future / open questions
- **Half-day direct manipulation** — deferred; current drag/resize snaps to workdays.
- **Click a block → open/scroll to the task** in List (nice-to-have).
- **Conflict surfacing** — a double-booked member could tint overlapping blocks.
