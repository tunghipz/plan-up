# Milestones

**Status:** Implemented
**Last updated:** 2026-07-15 (milestone hover time = its own instant `startOffset`
[08:00/12:00/17:00], not the hardcoded end-of-day — fixes every milestone reading 17:00)
**Code:** `app/src/SprintView.tsx` (`TaskRow`, `MilestoneTag`, member overdue count),
`app/src/BoardView.tsx` (`BoardCard` milestone chip), `app/src/GanttView.tsx` (diamond marker),
`app/src/db.ts` (`Task.estimate`)

## Purpose
A task with **`estimate === 0`** isn't really a chunk of work — it's a **milestone**:
a zero-duration checkpoint (a key date, a release, a sign-off). Before this, a
0-effort task rendered like an ordinary one-day task (`0` in Effort, a `Start → End`
span), which was ambiguous — indistinguishable from a task someone forgot to size.
This makes milestones read as what they are: **a moment, not a span.**

## User-facing behavior
In the List view, a leaf task whose **Effort = 0** is shown as a milestone:
- A small **`◆ Milestone`** pill sits after the task title (accent-tinted, like the
  priority chip), so it's labelled in plain words — discoverable without prior knowledge.
- The **Start and End columns collapse into a single milestone date** (a milestone is
  one point in time, so a `Start → End` span is meaningless). The date is shown in
  **accent color + bold** to read as a key marker. Its hover **time is the milestone's
  own instant** — the moment its prereqs are met (`plan.startOffset`), mapped as a
  completion moment: `08:00` (day start / a manual milestone), `12:00` (a prereq
  finishing at midday), or `17:00` (end of day). `startTime` and `endTime` are the
  **same** value (an instant has no span), so views can read either. A milestone
  whose prereq finishes at 17:00 reads `17:00`; one finishing at noon reads `12:00`
  (2026-07-15 fix — earlier it read the hardcoded `dueFraction` and so showed `17:00`
  for *every* milestone, contradicting the `startOffset` it actually anchors dependents on).
- The **Effort cell still shows `0` and stays editable** — changing it to a non-zero
  value turns the row back into a normal task (and the two date columns return).

This is distinct from **Effort = `—`** (`estimate === null`), which means *not estimated*
and still shows the ⚠ "not estimated" warning — see [list-view.md](./list-view.md).

**Overdue.** A milestone has no due span, so its overdue check uses the milestone date
(its start). A past, unfinished milestone shows its date in **red** and counts toward the
member header's overdue tally / next-due, like any task.

**Other views.**
- **Board** ([board-view.md](./board-view.md)) — the card shows a `◆ {date}` chip in accent
  (red when past-due & unfinished) in place of the Due chip.
- **Timeline** ([gantt-view.md](./gantt-view.md)) — the milestone renders as a **diamond**
  on its date (status-coloured) with a label, instead of falling into "no dates". A
  milestone on a non-working day falls back to "no dates".

## Data
No schema change. A milestone is **derived**, not stored: `task.estimate === 0`.
`null` (unset) vs `0` (milestone) vs `> 0` (normal) are the three meaningful states of
the existing `Task.estimate` field (see [data-model.md](./data-model.md)).

## Implementation
- `const isMilestone = task.estimate === 0` in `TaskRow`.
- Title pill: passed via `TitleTextarea`'s existing `trailing` slot (`<MilestoneTag />`).
- Collapsed date: when `isMilestone`, the two `COL.start` + `COL.due` cells are replaced
  by one `w-[236px]` cell (= `w-28` + `gap-3` + `w-28`, so the Status column stays put)
  holding a single editable `DatePickCell` bound to `startDate`.
- The pill's diamond is a CSS rotated square (`rotate-45`), not a glyph font — crisp at any size.

## Rules & edge cases
- **Only leaf tasks.** Parent/group rows roll up their children's effort, so the
  milestone treatment doesn't apply to them.
- **Scheduling unchanged.** Effort-0 tasks were already excluded from effort-driven
  scheduling (`scheduling.md`); this is a pure display change.
- The Start/End **column headers are unchanged** — milestone rows are the exception that
  spans them; normal rows keep both columns.

## Future / open questions
- Milestone marker in the **Calendar** (collections) view, if collections ever adopt
  effort-0 semantics (today collections are non-scheduled, so this is N/A).
