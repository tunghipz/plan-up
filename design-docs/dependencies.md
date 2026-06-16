# Dependencies (prerequisites)

**Status:** Implemented
**Last updated:** 2026-06-05
**Code:** `app/src/db.ts` (`addDependency`, `removeDependency`, `setDependencies`,
`wouldCreateCycle`, `findCyclePath`, `isTaskBlocked`), `app/src/SprintView.tsx`
(`PrereqInput`, `SelectionBar`), `app/src/lib.ts` (`parsePrereqSeqs`, `formatSeqRanges`),
`app/src/index.css` (`.prereq-chip*` path-trace animation)

## Purpose
Express "this can't start until those are done" so the scheduler can chain dates and the
UI can flag blocked work.

## User-facing behavior
- The **Prereq** column input takes **sequence numbers** — a list and/or inclusive
  **ranges**: `2, 3`, `2-5`, or mixed `2-5, 8` (parsed by `parsePrereqSeqs`; `5-2` is
  tolerated and normalised to `2..5`). On blur/Enter they resolve to task IDs and save.
- The saved set is shown **collapsed into ranges** (`formatSeqRanges`): dependsOn on
  2,3,4,5,8 renders as `2-5, 8`, so even a long chain stays readable in the narrow column.
- **Rejections are no longer silent.** If a typed number can't apply, a small popover under
  the field says why and which numbers were dropped, then auto-dismisses (~4.5s):
  - `Dropped #9 — creates a cycle` **plus the loop drawn as a path-trace**: the sequence
    numbers render as chips with arrows that pop in left→right (`7 → 9 → 8 → 6 → 7`); the
    head node (the edited task) rings amber and the closing node — where the loop returns
    to it — rings red and pulses once. Below it, an actionable hint names the back-edge to
    cut: `Remove #7 from #6 to break it`. The path comes from `findCyclePath` (BFS over
    `dependsOn`, shortest loop); the back-edge is its second-to-last node. Pure CSS
    animation (`.prereq-chip` / `prereq-close-pulse` in `index.css`, staggered via an
    inline `--d` delay). Self-links are skipped quietly (not a "cycle").
  - `Dropped #12 — not in this sprint` — no task with that sequence in this sprint.
  The valid entries still save; only the rejected ones are dropped, and the field snaps to
  the saved (range-collapsed) set.
- A task waiting on an unfinished prereq is **blocked** (row tooltip: "Blocked — waiting on
  a prerequisite task").

### Why a cycle gets rejected (the common confusion)
Dependencies form a DAG. If task 6 already depends on 7, you cannot also make 7 depend on
9 when 9 → 8 → 6, because that closes the loop 7 → 9 → 8 → 6 → 7. `setDependencies` drops
exactly the offending edge (keeping the rest) and `PrereqInput` now names it. To actually
chain them, remove the back-edge first (here: clear 6's dependency on 7).

## Data
`Task.dependsOn: string[]` — task **IDs** of prerequisites.

## Implementation
- `wouldCreateCycle(taskId, newDepId)` (`db.ts:711`) — DFS from the new dep; rejects if it
  can reach `taskId`. Self-links rejected.
- `setDependencies(taskId, ids)` (`db.ts:766`) — replaces the set; filters self-links,
  duplicates, unknown IDs, and cycles with a **cumulative** check (so a batch can't sneak a
  cycle past via ordering). Returns the cleaned set; triggers `recomputeDates`.
- `addDependency` / `removeDependency` — single-edge helpers, each recomputes.
- `isTaskBlocked(task, tasksById)` (`db.ts:796`) — `true` if not done AND any prereq isn't
  done. Done tasks never report blocked.
- `PrereqInput` parses input via `parsePrereqSeqs` (list + ranges), resolves sequence→ID
  **within the same sprint only** (sequences are per-sprint; cross-sprint deps survive but
  can't be typed by number), then diffs the requested set against what `setDependencies`
  returned to report cyclic vs unknown numbers in a portal popover. Display uses
  `formatSeqRanges`.

## Bulk actions (multi-select)
The selection toolbar (`SelectionBar` in `SprintView.tsx`, shown when ≥1 task is selected)
offers two prereq actions alongside Group / Ungroup / Delete. Both reuse `setDependencies`
per task, so cycle/self/duplicate filtering, activity-log entries, and date recompute all come
for free. Single click, **no confirmation** (the sprint activity log records old→new as the safety net).

- **Chain prereqs** — enabled only with **≥2** selected (else disabled, tooltip "Select ≥2
  tasks to chain"). Orders the selected tasks **top-to-bottom by their displayed order** and,
  for each adjacent pair (A above B), makes **B depend on A**. Existing prereqs are **kept**
  (additive): `setDependencies(B.id, unique([...B.dependsOn, A.id]))`. Only the chain's head
  is left untouched → **N-1** calls, run **sequentially top-to-bottom** so each task's
  recomputed dates are in place before the next link is computed (dates cascade correctly).
- **Clear prereqs** — enabled when ≥1 selected task has a non-empty `dependsOn`. Wipes every
  selected task's prereqs entirely: `setDependencies(task.id, [])` for each.

After either action the selection is cleared. The chain is built top-to-bottom and is a
forward DAG, so it can't introduce a cycle among the selected tasks; `setDependencies` still
guards against cycles formed via pre-existing prereqs.

`SelectionBar` labels are English: **Group**, **Ungroup**, **Delete**, **Cancel**, plus the
new **Chain prereqs** / **Clear prereqs**.

## Rules & edge cases
- Because links are by ID, sprint renumbering and rollover never break them.
- Deleting a task strips its ID from every other task's `dependsOn` and recomputes them.
- Selection state clears when the sprint changes, so bulk prereq actions are always
  same-sprint (matching the per-sprint sequence model).
