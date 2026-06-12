# Sprint rollover

**Status:** Implemented
**Last updated:** 2026-06-12
**Code:** `app/src/App.tsx` (`RolloverPopover`, Roll over button), `app/src/db.ts`
(`moveUnfinishedToNextSprint`, `dedupeSprints`)

## Purpose
At sprint's end, carry everything not finished into the next sprint in one click,
without manual re-entry.

## User-facing behavior
- The **Roll over** button (header) appears only when: a current sprint exists, a next
  sprint exists, and there are unfinished tasks. It shows the unfinished count.
- Click → **anchored popover** (`RolloverPopover`, not a center modal) that **previews the
  exact tasks that will move** — a read-only scrollable list (status dot · `#seq` ·
  priority tag · title · assignee avatar · due date, overdue dates in red). Header
  *"Roll over → {next sprint}"*, sub *"N unfinished tasks from {current}"*; footer
  **Cancel** / **Move N**.
- **Move** → all not-done tasks move to the next sprint (chronologically the smallest
  `startDate` greater than source's); the popover closes and selection follows to the
  target sprint. It's move-all (no per-task selection) — matches `moveUnfinishedToNextSprint`.
- Popover follows the date-picker portal pattern (§5.5): `createPortal` + fixed position
  pinned to the button rect (re-pins on scroll/resize, flips up if it would overflow the
  viewport), outside-click / **Esc** to dismiss. Lives in a portal because the main column
  is `overflow-hidden` and would clip an in-flow popover. Float shadow §4.2.
- *Decision 2026-06-12*: replaced the center confirm sheet (`useConfirm`) with this
  preview popover so the user sees **what** rolls over before committing — confirm-by-preview
  instead of confirm-by-text. The old sheet lives in git history.

## Data
Mutates moved `Task` rows: `sprintId`, `sequence`, sometimes `startDate`.

## Implementation
`moveUnfinishedToNextSprint(sourceSprintId)` (`db.ts:631`):
1. Find the next sprint by `startDate`; bail (null target) if none.
2. For each not-done task: set `sprintId = target`, assign **`sequence = nextSequence(target)`**
   (awaited in-loop so each sees the prior insert), and bump `startDate` up to the target
   sprint's start if it was earlier.
3. `recomputeDates()` each moved task so prereq chains + off-days resettle in the new home.
- Done tasks stay put. `dependsOn` links survive (they reference task IDs, not sequence).

## Rules & edge cases
- **Renumbering on move is essential**: sequence is per-sprint, so a bare `sprintId` swap
  would carry the source number over and collide with an existing task in the target
  (two rows showing the same `#N`). The same renumber applies in `dedupeSprints`.
- Covered by tests in `app/src/db.test.ts` (collision repro for both rollover and merge).
