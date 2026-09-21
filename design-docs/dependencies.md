# Dependencies (prerequisites)

**Status:** Implemented
**Last updated:** 2026-09-21 (a dependent now renders **directly under its prerequisite in
every sort**, not only in the manual order — see *Dependents stick to their prerequisite*)
**Previously:** 2026-09-11 (setting a prereq auto-moves the row under its prerequisite)
**Code:** `app/src/db.ts` (`addDependency`, `removeDependency`, `setDependencies`,
`wouldCreateCycle`, `findCyclePath`, `isTaskBlocked`), `app/src/reorder.ts`
(`planPrereqMove`, `orderBetween`), `app/src/SprintView.tsx`
(`PrereqInput`, `SelectionBar`), `app/src/lib.ts` (`parsePrereqSeqs`, `formatSeqRanges`,
`flattenDisplayOrder`), `app/src/index.css` (`.prereq-chip*` path-trace animation)

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
- **Setting a prereq moves the row under it.** When the saved set actually changes and is
  non-empty, the dependent is re-ordered to sit **directly below its prerequisite**, so the
  chain reads top-to-bottom instead of the dependent staying stranded at the bottom of the
  lane. Details:
  - The anchor is the prereq that sits **lowest in the lane's manual order**
    (`listOrder ?? sequence`) — with several prereqs, the row lands under the last of them
    (everything it waits on is above it). This is the **stored** move; the display rule below
    keeps the pairing visible while a sort column is active.
  - Only prereqs in the **same lane** count: same sprint (or collection + section), same
    assignee, same group parent.
    A cross-lane prereq moves nothing, because "moving" there would mean reassigning the task
    or pulling it into another group — a data edit the user didn't ask for.
  - Already directly below → no write (the drag's own-gap no-op).
  - Manual order is only touched at the moment the prereq is saved. Drag the row afterwards
    and it stays where you put it.
  - **Bulk "Chain prereqs"** inherits this (it calls `setDependencies` per pair, top-to-bottom),
    so a chained selection ends up contiguous and in chain order.
- **Dependents stick to their prerequisite — in every sort.** Writing `listOrder` only fixes
  the *manual* order; the moment a sort column is on, the lane renders by that column and the
  dependent drifts back to wherever its End/Status/Title puts it (an unscheduled dependent
  with an empty End lands at the bottom, the exact thing the move was meant to fix). So the
  pairing is also applied **at display time**, after sorting:

  `orderLane()` (`task-sort.ts`) sorts the lane as before, then **pulls each dependent to sit
  immediately after its prerequisite**. Rules:
  - The anchor is the prereq that ends up **lowest in the sorted lane**, so a row with several
    prereqs still sits below all of them.
  - Only prereqs in the **same lane and the same group scope** (same `parentId`) count —
    identical to the stored move, and for the same reason: pulling across scopes would mean
    re-parenting a row nobody asked to re-parent.
  - Chains nest: `A → B → C` renders A, B, C contiguous. Several dependents on one prereq keep
    the sort's order among themselves.
  - This is the same contract group children already have (`flattenDisplayOrder` + `TaskTable`
    nest a child under its parent no matter which column is sorted), so the List has one rule,
    not two.
  - **Accepted cost:** with a sort on, the sorted column is no longer monotonic down the lane —
    a dependent with an empty End can sit between two dated rows. Adjacency to the prerequisite
    is the thing being asked for; a purely topological order ("somewhere after the prereq")
    would leave that dependent at the bottom and change nothing on screen.
  - The PNG export reuses `orderLane()`, so the image matches the screen row for row.
- A task waiting on an unfinished prereq is **blocked** (row tooltip: "Blocked — waiting on
  a prerequisite task"). A prereq that is a **group (parent) task** counts as done only when
  **every child** of that group is done.
- **A group can be a prerequisite** — `dependsOn` may reference a parent task's sequence; the
  dependent starts after the group's rolled-up end. Because depending on a group means
  depending on all its children, the cycle check treats `parent → children` as edges (a child
  can't depend back on a task that waits on its own group). You still cannot set a prereq *on*
  a group. See [task-groups.md](./task-groups.md) "Group as a prerequisite".

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
- `setDependencies(taskId, ids)` (`db.ts`) — replaces the set; filters self-links,
  duplicates, unknown IDs, and cycles with a **cumulative** check (so a batch can't sneak a
  cycle past via ordering). Returns the cleaned set; triggers `recomputeDates`.
- `addDependency` / `removeDependency` — single-edge helpers, each recomputes. They do **not**
  auto-move (no UI path reaches them; the List's Prereq field and the bulk actions both go
  through `setDependencies`).
- `planPrereqMove(lane, taskId, prereqIds, orderOf)` (`reorder.ts`) — the pure planner behind
  the auto-move. Picks the lowest-positioned prereq in `lane`, then reuses the **same slot math
  as drag-and-drop** (`computeDropSlot(..., 'after')` + `resolveDropOrder`): `null` when there
  is nothing to do, `{ kind: 'set', order }` for the normal one-row write, and
  `{ kind: 'renormalize', orderedIds }` when repeated midpoint inserts exhaust float precision.
  `setDependencies` applies the result inside its own transaction via `setListOrder` /
  `renormalizeListOrder`. Manual order is never logged (it isn't a `LoggableField`).
- **All three run inside ONE transaction** (`db.transaction('rw', …)`): the cycle check,
  the `dependsOn` read-modify-write and the recompute can't interleave with another
  dependency edit (a stale-array overwrite would silently drop an edge) or split on a
  mid-write crash. `setDependencies`' scope also includes `db.events`, so the deps write,
  the recompute **and** the activity-log entry commit atomically — there is no
  deps-changed-without-log window.
- `isTaskBlocked(task, tasksById)` — `true` if not done AND any prereq isn't done. A prereq
  that is a **parent** is "done" only when all its children are done. Done tasks never report blocked.
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
  for each adjacent pair (A above B), makes **B depend on A**. "Displayed order" is the exact
  on-screen row order — member lanes in lane order, each lane sorted by the active sort column,
  group children nested under their head, Unassigned last — computed by `flattenDisplayOrder`
  (`lib.ts`). It is **not** the raw IndexedDB array order; chaining the raw order would scramble
  the links versus what the user sees. Existing prereqs are **kept**
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
