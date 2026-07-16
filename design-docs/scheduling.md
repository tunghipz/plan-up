# Auto-scheduling engine

**Status:** Implemented
**Last updated:** 2026-07-02
**Code:** `app/src/scheduling.ts` (`planFor`, `computeStartEnd`, `computeWorkingPlan`,
`computeWorkingTimes`, `recomputeDates`, `recomputeAllDates`)

## Purpose
Turn *effort + prerequisites + availability* into concrete start/end dates (and wall-clock
times) automatically, so the plan stays correct as inputs change — no manual date math.

## Model
- **Workday:** 08:00–12:00 (AM) + 13:00–17:00 (PM). Each half = **0.5 day**; lunch is a
  non-counting break. Wall fraction: `0` = 08:00, `0.5` = noon/13:00, `1` = 17:00.
- **Non-working time:** weekends (Sat/Sun) contribute 0; a member's full off-day = 0; a
  half off-day (AM or PM) = 0.5.
- **`estimate`** is the effort in days that the engine consumes across working time.

## Algorithm (`planFor`, memoized per task)
1. **Start:** no prereqs → use the task's manual `startDate`. With prereqs → the start is
   **purely prereq-derived** (the cell is locked), so the stored `startDate` is ignored and
   the start is taken from the latest prereq's finish — same day if there's leftover capacity
   after it, else the next working day. **A milestone prereq** (effort 0) is a zero-duration
   checkpoint whose date lives in `startDate` (its `dueDate` is null / a stale leftover), so a
   dependent anchors on the **milestone date** at the milestone's **own wall time** (its
   `startOffset`), not a hard-coded end-of-day. A milestone at 08:00 lets the dependent start
   **the same day at 08:00** (there's a full working day of leftover capacity after the
   instant); a milestone late in the day pushes the dependent to the next working day, exactly
   like any other prereq's finish moment. **A milestone *dependent*** (the task being
   scheduled is itself effort 0) is the mirror case: it consumes no capacity, so it sits on
   the **prereq's finish day + fraction** and is **never pushed to the next working day** — a
   prereq ending Fri 17:00 dates the milestone Fri, not Mon. Only tasks that need room to do
   work take the capacity-then-next-day path. *(2026-07-14: first fix made a milestone prereq
   anchor on its date at all — before that it was skipped / chained off its stale `dueDate`.
   Later same-day: the milestone was mistakenly treated as finishing at end-of-day [fraction 1]
   regardless of its shown time, costing the dependent a day — e.g. a 08:00 milestone pushed
   the successor to the next day at 08:00. Now it honours the milestone's actual time.)*
   **If no prereq has a usable finish yet** (e.g. you re-link to an unscheduled task) there's no
   anchor, so the start **clears to `null`** rather than lingering at the value a *previous*
   prereq produced; it fills back in once a prereq is scheduled (the BFS cascade re-runs).
2. **Normalize** start past weekends/off-days (and to the day's natural start if AM is off).
3. **Consume effort** day by day, taking `min(remaining, available)` until the estimate is
   spent; the final day's wall position becomes the due fraction.
- No effort and no prereqs → dates stay **manual** (whatever the user set).
- **Parent (group) tasks**: a task that has children is scheduled as the **rolled-up span** of
  its children — `startDate` = earliest child start, `dueDate`/`dueFraction` = the latest child
  finish. Its own estimate/start/`dependsOn` are ignored. This makes a group a valid **prereq
  anchor** (a dependent reads the span end). `planFor` carries an `inProgress` guard so a cycle
  introduced through group membership resolves to "no plan" instead of recursing forever.

## Public functions
- `computeStartEnd(task, …)` — `{ startDate, dueDate }`.
- `computeWorkingPlan(task, …)` — adds `startTime`/`endTime` (e.g. `08:00`, `17:00`,
  `12:00`, `13:00`) from one pass so date & time never drift. **Views render from this.**
- `computeWorkingTimes(…)` — just the times.
- `recomputeDates(taskId)` — recompute this task and BFS-walk forward through dependents;
  idempotent (stops when nothing changes). Runs after edits to effort/start/assignee/deps.
- `recomputeAllDates()` — recompute & persist every task; heals drift; run on app load.

## Rules & edge cases
- A task whose end is engine-driven (has prereqs, or effort > 0) shows a **locked** date
  cell — clear the prereqs/effort to edit manually.
- Computations always derive from fresh state, never trusting a possibly-stale stored
  `dueDate`, so they're order-independent and safe to re-run.
