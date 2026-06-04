# Schedule conflict warning

**Status:** Implemented
**Last updated:** 2026-06-04
**Code (planned):** `app/src/SprintView.tsx` (`computeMemberConflicts`, `MemberCard`
detection, `GroupHeader` badge, `TaskRow`/`TitleTextarea` row icon)

## Purpose
Flag when one member is **double-booked** — two of their tasks are scheduled to
happen at the same time, or both unblock together — so the plan's overlap is
visible without reading every row. A soft warning (Apple **system orange**, not a
red error): the schedule still works, it just may not be physically doable by one
person at once.

## Detection rule (confirmed 2026-06-04)
Within a **single member's** tasks (unassigned tasks are skipped), an unordered
pair (A, B) **conflicts** if **any** of:
1. **Same start** — identical computed start datetime (date + time), or
2. **Same end** — identical computed due datetime (date + time), or
3. **Shared prerequisite** — `dependsOn(A) ∩ dependsOn(B)` is non-empty (they wait
   on at least one common task, so they unblock together).

- Compared against the **computed plan** (`computeWorkingPlan`), the same start/end
  the row shows — never raw stored dates.
- Only **leaf** tasks participate (parents/group containers are excluded, matching
  leaf-based counting — see [task-groups.md](./task-groups.md)). A grouped child
  still warns if it conflicts with any other leaf task of the member, across groups.
- A task is "in conflict" if it forms a conflicting pair with ≥1 other task.

## User-facing behavior (chosen: A + C)
- **Per-row icon + tooltip (from option A):** each conflicting row shows a small
  **amber warning triangle** (`AlertTriangle`, `--color-priority-high`) trailing the
  title. Hover/tap → tooltip naming the other task(s) and which dimension clashes,
  e.g. *"Overlaps with #34 (start time, end time); #35 (shared prerequisite)"*.
- **Header total badge (from option C):** the **member group header** shows an amber
  chip `△ N` (count of that member's conflicting tasks) when N > 0, next to the
  existing overdue/next-due stats. Gives at-a-glance awareness; the per-row icons
  show exactly which rows.
- **Not** chosen: cell tinting (option B) and the left amber bar (option C's bar —
  it would clash with the group parent's accent bar).

## Implementation notes
- `computeMemberConflicts(leafTasks, tasksById, memberById)` → `Map<taskId,
  Conflict[]>` where `Conflict = { otherSeq: number; kind: 'start'|'end'|'prereq' }`.
  O(n²) over a member's leaf tasks (n is tiny per member — fine).
- `MemberCard`: run it on `leafTasks`; derive
  - `conflictTips: Map<taskId, string>` (tooltip text, grouped by other sequence),
  - `conflictCount = conflictTips.size` → passed to `GroupHeader`.
- `GroupHeader`: new optional `conflictCount?: number`; render the amber chip in the
  right-hand stat cluster when > 0.
- `TaskRows` forwards `conflictTips` to each `TaskRow`; `TaskRow` passes
  `warn={conflictTips.get(task.id)}` to `TitleTextarea`, which renders the trailing
  `AlertTriangle` with `title={warn}` when present.
- Colors via `--color-priority-high` token (light `#ff9500` / dark `#ff9f0a`) — no
  hardcoded hex (design-system §8.2).

## Rules & edge cases
- **Same member only**; unassigned card never warns (no single owner).
- **Self never conflicts with itself**; pairs are unordered (each side gets an icon).
- **Done tasks**: still compared (a same-time clash is a clash regardless of status);
  revisit if it proves noisy — could skip pairs where both are `done`.
- **Parents/groups** excluded from detection (containers).
- **Dark mode**: token swaps to `#ff9f0a` automatically.

## Future / open questions
- Per-task-group header badge (in addition to the member header) — deferred; the
  member header is the scheduling scope.
- Smarter overlap (ranges that *intersect*, not just identical endpoints) — current
  rule is exact start/end match per the confirmed spec; widen later if wanted.
- Board view: not shown there this round.
