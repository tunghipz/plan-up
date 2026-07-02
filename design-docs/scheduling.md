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
   after it, else the next working day. **If no prereq has a due date yet** (e.g. you re-link
   to an unscheduled task) there's no anchor, so the start **clears to `null`** rather than
   lingering at the value a *previous* prereq produced; it fills back in once a prereq is
   scheduled (the BFS cascade re-runs).
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
