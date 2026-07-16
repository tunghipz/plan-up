# Schedule conflict warning

**Status:** Implemented
**Last updated:** 2026-07-02 (`computeMemberConflicts` moved to `sprint-logic.ts`)
**Code:** `app/src/sprint-logic.ts` (`computeMemberConflicts` — pure module shared by
List/Board/Timeline, alongside `STATUS_META`/`derivedGroupStatus`), `app/src/SprintView.tsx`
(`MemberCard` detection, `GroupHeader` badge, `TaskRow`/`TitleTextarea` row icon)

## Purpose
Flag when one member is **double-booked** — two of their tasks are scheduled to
happen at the same time, or both unblock together — so the plan's overlap is
visible without reading every row. A soft warning (Apple **system orange**, not a
red error): the schedule still works, it just may not be physically doable by one
person at once.

## Detection rule (overlap added 2026-06-05)
Within a **single member's** tasks (unassigned tasks are skipped), an unordered
pair (A, B) **conflicts** if **any** of:
1. **Time overlap** — their computed `[start … end]` datetime intervals **intersect**
   (strict: `aStart < bEnd && bStart < aEnd`). One person can't run two tasks at the
   same time. This is the primary rule; it subsumes the old same-start / same-end
   cases (two positive-duration tasks sharing a start or an end necessarily overlap).
2. **Same start** — identical computed start datetime (kept as a fallback for the
   rare zero-duration / instant task, where strict overlap is empty), or
3. **Same end** — identical computed due datetime (same fallback reason), or
4. **Shared prerequisite** — `dependsOn(A) ∩ dependsOn(B)` is non-empty (they wait
   on at least one common task, so they unblock together). Checked independently of
   time overlap.

- A pair flagged by **overlap** is labeled only `chồng thời gian` — it does **not**
  also emit the redundant `giờ bắt đầu` / `giờ kết thúc` labels (those fire only when
  the intervals do *not* strictly overlap but an endpoint is identical).
- Back-to-back tasks **don't** conflict: touching endpoints (A ends 12:00, B starts
  13:00; or A ends 17:00, B starts next morning) are not a strict intersection.
- Compared against the **computed plan** (`computeWorkingPlan`), the same start/end
  the row shows — never raw stored dates. Datetime keys are `YYYY-MM-DDTHH:MM` with
  zero-padded times (`08:00`/`12:00`/`13:00`/`17:00`), so plain string `<` compares
  chronologically.
- Only **leaf** tasks participate (parents/group containers are excluded, matching
  leaf-based counting — see [task-groups.md](./task-groups.md)). A grouped child
  still warns if it conflicts with any other leaf task of the member, across groups.
- **Tasks with no effort estimate (`estimate === null`) are excluded** — an unsized
  task isn't really scheduled, so comparing its start/end (or prereqs) for
  double-booking is meaningless. Added 2026-06-04.
- A task is "in conflict" if it forms a conflicting pair with ≥1 other task.

## User-facing behavior (chosen: A + C)
- **Per-row icon + tooltip (from option A):** each conflicting row shows a small
  **amber warning triangle** (`AlertTriangle`, `--color-priority-high`) in a dedicated
  **left warn gutter** (`COL.warn`, before the status dot / ID — present but empty on
  non-conflicting rows so columns stay aligned). Hover/tap → tooltip naming the other
  task(s) and which dimension clashes, e.g. *"Trùng lịch với #34 (giờ bắt đầu, giờ
  kết thúc); #35 (chung prereq)"*.
- **Header total badge (from option C):** the **member group header** shows an amber
  chip `△ N trùng lịch` (spelled-out count) when N > 0, next to the existing
  overdue/next-due stats. Gives at-a-glance awareness; the per-row icons show which rows.
- Warning copy is **Vietnamese** (matches the user's demo); the rest of the row UI is
  unchanged.
- **Not** chosen: cell tinting (option B) and the left amber bar (option C's bar —
  it would clash with the group parent's accent bar).

## Implementation notes
- `computeMemberConflicts(leafTasks, tasksById, memberById)` → `Map<taskId,
  Conflict[]>` where `Conflict = { otherSeq: number; kind: 'overlap'|'start'|'end'|'prereq' }`.
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
- ~~Smarter overlap (ranges that *intersect*, not just identical endpoints)~~ —
  **done 2026-06-05** (rule #1 above). Intervals that intersect now conflict.
- Board view: not shown there this round.
