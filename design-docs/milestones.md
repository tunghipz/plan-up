# Milestones

**Status:** Implemented
**Last updated:** 2026-06-19
**Code:** `app/src/SprintView.tsx` (`TaskRow`, `MilestoneTag`), `app/src/db.ts` (`Task.estimate`)

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
  one point in time, so a `Start → End` span is meaningless). The date (with its
  time) is shown in **accent color + bold** to read as a key marker.
- The **Effort cell still shows `0` and stays editable** — changing it to a non-zero
  value turns the row back into a normal task (and the two date columns return).

This is distinct from **Effort = `—`** (`estimate === null`), which means *not estimated*
and still shows the ⚠ "not estimated" warning — see [list-view.md](./list-view.md).

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
- Mirror the diamond marker in the **Timeline / Gantt view** (`gantt-view.md`) so
  milestones show as diamonds on the lane instead of zero-width blocks.
