# Sprint rollover

**Status:** Implemented
**Last updated:** 2026-07-06
**Code:** `app/src/App.tsx` (`RolloverPopover`, Roll over button), `app/src/db.ts`
(`planSprintRollover`, `moveUnfinishedToNextSprint`, `dedupeSprints`)

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
- **A moved task keeps ALL its information — including its start/due dates — unchanged.**
  Only `sprintId` and `sequence` change on the move itself. Effort / prereq / off-day
  recomputation still runs afterwards exactly as before (so an effort-driven end still
  follows its start, a prereq-locked start still tracks its prerequisite), but the stored
  `startDate` you set is **never rewritten to the target sprint's start**. *(Decision
  2026-07-06: a rolled-over task must preserve its dates — the user's start time is theirs.
  A consequence is that a task whose start predates the new sprint keeps that earlier start
  and so begins before the new sprint's window; that is accepted in exchange for never
  silently discarding a start the user chose. The earlier "pull stale starts forward to the
  target start" rule is removed; it lives in git history.)*
- Popover follows the date-picker portal pattern (§5.5): `createPortal` + fixed position
  pinned to the button rect (re-pins on scroll/resize, flips up if it would overflow the
  viewport), outside-click / **Esc** to dismiss. Lives in a portal because the main column
  is `overflow-hidden` and would clip an in-flow popover. Float shadow §4.2.
- *Decision 2026-06-12*: replaced the center confirm sheet (`useConfirm`) with this
  preview popover so the user sees **what** rolls over before committing — confirm-by-preview
  instead of confirm-by-text. The old sheet lives in git history.

## Data
Mutates moved `Task` rows: `sprintId` and `sequence` only. `startDate`/`dueDate` are left
as-is on the move (recompute may still re-derive them for effort/prereq tasks, same as any
other edit — but the move never overwrites a manually-set date).

## Task groups (parent + children)
A group must never be **split across sprints** — every view nests children under their
parent, so a child stranded in a sprint without its parent (or vice-versa) renders nowhere
(Board/Timeline) or as a stray top-level row (List). Rollover therefore treats a group as a
unit, using the **leaf children's** done-ness — *not* the parent's own stored `status`,
which is a derived/container field (see `task-groups.md`):

- **Group with ≥1 unfinished child** → the **parent + all unfinished children** move to the
  target together. Each **done child stays in the source sprint and is ungrouped**
  (`parentId → null`), becoming a normal standalone task there. *(Decision 2026-06-30:
  done work is left behind as the rest of the group advances, matching the per-task
  "done stays put" rule — but the group itself is never torn apart.)*
- **Fully-done group** (every child done) → the whole group stays put, parent included.
  The parent never rolls over on its own stored status alone.
- **Standalone task** (no parent, no children) → unchanged: moves iff not done.

The move-set is computed once by the pure helper **`planSprintRollover(tasks)`**, shared by
both the DB move and the preview popover so the previewed list and the actual move can never
disagree.

## Implementation
`planSprintRollover(sprintTasks)` (`db.ts`) → `{ moveIds, ungroupIds, parentIds }` (all
`Set<string>`), applying the group rules above. The user-facing count / preview is
`moveIds − parentIds` (leaf work items; container parents tag along silently).

`moveUnfinishedToNextSprint(sourceSprintId)` (`db.ts`):
1. Find the next non-archived sprint by `startDate` **within the source sprint's
   project**; bail (null target) if none. *(The sprint scan is scoped to
   `projectId` — an unscoped `orderBy('startDate')` over the whole table would let
   a foreign project's sprint sharing/near the start date win, silently rolling
   tasks into a different project while the real next sprint stays empty.
   Must match App.tsx `nextSprint`, which is already per-project.)*
2. `planSprintRollover` the source sprint's tasks. Clear `parentId` on every `ungroupIds`
   task (done children that stay).
3. For each `moveIds` task: set `sprintId = target` and assign **`sequence = nextSequence(target)`**
   (awaited in-loop so each sees the prior insert). **`startDate`/`dueDate` are left untouched** —
   the task keeps the dates the user set.
4. `recomputeDates()` each moved task so prereq chains + off-days resettle in the new home
   (this re-derives dates for effort/prereq tasks the same way any edit does; it does not
   clobber a manual start).
- `dependsOn` links survive (they reference task IDs, not sequence). `movedCount` returned =
  leaf tasks moved (excludes container parents).

## Rules & edge cases
- **Renumbering on move is essential**: sequence is per-sprint, so a bare `sprintId` swap
  would carry the source number over and collide with an existing task in the target
  (two rows showing the same `#N`). The same renumber applies in `dedupeSprints`.
- **Groups are never split** (see above) — this is the reason rollover can't just filter on
  per-task `status`.
- Covered by tests in `app/src/db.test.ts` (collision repro for both rollover and merge;
  group cohesion: split-group, done-child ungroup, fully-done group stays, parent-not-alone).
