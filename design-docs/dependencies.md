# Dependencies (prerequisites)

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/db.ts` (`addDependency`, `removeDependency`, `setDependencies`,
`wouldCreateCycle`, `isTaskBlocked`), `app/src/SprintView.tsx` (`PrereqInput`)

## Purpose
Express "this can't start until those are done" so the scheduler can chain dates and the
UI can flag blocked work.

## User-facing behavior
- The **Prereq** column input takes comma-separated **sequence numbers** (e.g. `2, 3`).
  On blur/Enter they resolve to task IDs and save; invalid/self/cyclic entries are dropped
  silently and the field snaps back to the saved set.
- A task waiting on an unfinished prereq is **blocked** (row tooltip: "Blocked — waiting on
  a prerequisite task").

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
- `PrereqInput` resolves sequence→ID **within the same sprint only** (sequences are
  per-sprint); cross-sprint deps survive but can't be typed by number.

## Rules & edge cases
- Because links are by ID, sprint renumbering and rollover never break them.
- Deleting a task strips its ID from every other task's `dependsOn` and recomputes them.
