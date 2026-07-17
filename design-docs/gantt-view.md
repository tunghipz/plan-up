# Timeline view (calendar swimlanes)

**Status:** Implemented
**Last updated:** 2026-07-16 (added longer-range Timeline view, defaulting to month range)

> **Bar drag / resize → schedule edit (2026-07-16):** Timeline is no longer purely
> read-only for leaf task bars. Drag the body to move the task start date on the workday
> axis; drag an edge to change duration/effort. The write path is still the same
> scheduler-safe path as List/Board (`updateTask` + `recomputeDates`), so stored dates and
> dependents stay consistent.
>
> **Bar click → detail popover (2026-06-08):** event blocks were inert (chỉ `title`
> tooltip). Nay **bấm bar** mở popover Cupertino (portal + float-shadow) hiển thị
> title · status · ngày start–end + **"Open in List →"** (chuyển sprint view
> về List để sửa). Popover đọc **computed plan của chính bar** (`planById` — cùng nguồn
> bar được vẽ), **không phải** stored dates, nên popover và bar không bao giờ lệch nhau.
**Code:** `app/src/GanttView.tsx`, `app/src/App.tsx` (view toggle),
`app/src/lib.ts` (`sprintWorkdays`), reads `computeWorkingPlan` from `app/src/db.ts`,
reuses `STATUS_META` / `derivedGroupStatus` from `app/src/sprint-logic.ts` (pure module
shared by List/Board/Timeline) and `Avatar` from `app/src/members.tsx`

> **Redesign note (2026-06-04):** the first implementation was a dense half-day **cell
> grid** (AM/PM columns, hairline borders, zebra). That read as a spreadsheet/ledger and
> violated the Cupertino DNA (`design-system.md`: *depth not lines*, *calm*, *no heavy
> cell-grid separators*). It was torn down and rebuilt as an **Apple-Calendar-style
> swimlane** view. The old grid + its `halfDayCells` helper live in git history.

## Purpose
A calm, glanceable answer to **"when does each person's work happen?"** — the thing List
and Board can't show. The sprint Timeline answers that inside the selected sprint; the
Range Timeline answers it across a longer project window, usually one month. It is
primarily a scheduler projection, with direct manipulation for the two highest-frequency
schedule edits: move a task to another workday and change its duration.

## User-facing behavior
- **Sprint Timeline view in the segmented toggle** — `List · Board · Timeline · Range`.
  `Timeline` stays scoped to the selected sprint. `Range` opens the same swimlane timeline
  with a project-level date window. Active view is persisted at `localStorage['plan-up:view']`.
- **Range Timeline controls**:
  - Defaults to the calendar month containing the selected sprint start date.
  - Shows `Start` and `End` date inputs, plus quick actions for previous month, next month,
    `This month`, and `Current sprint`.
  - The range choice persists at `localStorage['plan-up:timelineRange']`.
  - It renders assigned project tasks whose computed schedule intersects the selected
    range. Planning still uses the full project task set, so dependencies and parent
    roll-ups remain correct even when only part of the project is displayed.
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
  - **A swimlane per member** — sticky-left label (avatar + name + role), separated by
    soft hairlines + whitespace (not heavy rules).
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
- **Direct schedule editing** for leaf tasks:
  - Drag the **body** of a normal task bar to move its start date to another visible
    workday. If the task has an effort, due date is recomputed from effort/off-days; if it
    has manual start/end dates and no effort, both endpoints shift by the same workday
    delta.
  - Drag the **right edge** to change duration/effort from the current start to the target
    edge. Effort is written in 0.5-day increments, minimum 0.5.
  - Drag the **left edge** to change both start date and duration/effort while keeping the
    right edge fixed.
  - Milestones (effort 0) can be dragged as a point to set their date, but cannot be
    resized.
  - Parent/group summary rails remain read-only projections. Tasks whose start is locked by
    prerequisites cannot be body-dragged; resizing effort is allowed because effort is still
    an editable input to the scheduler.
- **Milestones (effort 0)** render as a **diamond** on their date (status-coloured) with a
  label, not a span — the Gantt convention. A milestone on a non-working day falls back to
  the `no dates` bucket. See [milestones.md](./milestones.md).
- **Day-off** renders as a faint **diagonal-hatch** band in the member's lane (full day =
  whole column, half = its AM or PM half), from `member.daysOff` — **member-level**, so it
  shows even when no task spans it. Where a **task bar crosses a day-off**, the bar stays one
  continuous block but the overlapping slice is overlaid with a same-status **hatch + dim
  "pause"** — connecting the off-day to the task it interrupts (the bar visibly pauses there,
  rather than the off-day being a disconnected grey band behind it). Parent summary rails are
  exempt (they only show the lane's hatch behind them).
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
**No schema change. No new fields.** Display derives from existing data, and drag writes
the same task fields already edited in List/Board:
- Each task's span comes from `computeWorkingPlan(task, …)` →
  `{ startDate, dueDate, startTime, endTime }` at half-day precision
  (`startTime '13:00'` = PM start; `endTime '12:00'` = noon finish — see
  [scheduling.md](./scheduling.md)).
- Day-off bands from `member.daysOff` (`{ date, half? }[]` — see
  [members-and-days-off.md](./members-and-days-off.md)).
- Sprint `startDate` / `endDate` define the sprint Timeline column range.
- Range Timeline uses its selected `start` / `end` dates for columns, while computing task
  plans against all tasks in the current project.
- Drag body writes `Task.startDate` (and, for manual no-effort spans, also `Task.dueDate`).
- Resize writes `Task.estimate` in half-day increments, then recomputes stored dates.

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
  - Soft tints reuse the app pattern: `color-mix(in srgb, var(--color-status-X) 15%,
    transparent)` bg + `color-mix(…100%, #000 22%)` text + the raw token as the accent edge.
  - Pointer drag state is local to `GanttView`: body/left/right handles capture the pointer,
    map horizontal movement to half-day slots on the workday axis, show a lightweight preview,
    and commit on pointer-up via `updateTask` + `recomputeDates`.
- **`App.tsx`** — `ViewMode` includes `'timeline'` and `'range-timeline'`; `Timeline`
  renders `<GanttView … />` for the current sprint, while `Range` renders a date-range
  toolbar plus `<GanttView … />` using filtered visible tasks and the full project task set
  for planning.

## Rules & edge cases
- **Scheduler-safe edits only** — Timeline mutates only existing scheduling inputs
  (`startDate`, `dueDate` for manual spans, `estimate`). Prereq-derived starts and parent
  roll-up rails stay protected so Timeline cannot drift from List/Board.
- **Weekends excluded** from columns (scheduler contributes 0 there).
- **Manually-dated tasks on weekends snap for DISPLAY only.** The date picker legally allows
  weekend dates, but the day axis carries only workdays — a raw index lookup would misfile a
  mid-sprint weekend start into the `later` chip or silently stretch a weekend due date. So:
  a weekend **start snaps forward** to the next axis workday, a weekend **due snaps backward**
  to the previous one, and a span living **entirely inside one weekend clamps to a 1-day bar**
  on the nearest in-sprint axis day (forward when the sprint has one, else backward).
  **Nothing is written to the DB** — the stored dates stay untouched.
- **Nothing is hidden** — every assigned task is either a block, a `later` chip, or a
  `no dates` chip. Off-window/unscheduled counts sit in the member label, expandable.
- **Parent/group tasks**: a parent is a container with no own dates; it renders as a
  **summary rail** spanning its children's roll-up span (earliest start … latest end),
  while each child also appears as its own block. Only when *no* child has dates does the
  parent fall to the `no dates` bucket. A block that starts before the window's left edge is
  clamped to the edge with a `‹` caret (mirrors the `›` right-edge caret).
- Active view persisted at `localStorage['plan-up:view']` (accepts `'timeline'` and
  `'range-timeline'`).
- Range values are normalized so `start <= end`; invalid stored values fall back to the
  selected sprint's month.

## DNA check (`design-system.md`)
Depth not lines (one card + soft hairlines, no cell grid) ✓ · system status colors ✓ ·
SF tabular-nums for dates ✓ · radius ≥ 14 card / soft blocks ✓ · accent as signal (today
line, off-window chips) ✓ · calm, content breathes ✓ · dark-mode via tokens ✓.

## Future / open questions
- **Click a block → open/scroll to the task** in List (nice-to-have).
- **Conflict surfacing** — a double-booked member could tint overlapping blocks.
