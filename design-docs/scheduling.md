# Auto-scheduling engine

**Status:** Implemented
**Last updated:** 2026-09-21 (the engine no longer rewrites dates it does not own: a manual
start is never pushed off a weekend, and collection items are exempt entirely)
**Code:** `app/src/scheduling.ts` (`planFor`, `computeStartEnd`, `computeWorkingPlan`,
`computeWorkingTimes`, `recomputeDates`, `recomputeAllDates`, `expandHolidaysNamed`,
`expandHolidays`, `mergeOffPart`, `normalizeHolidays`, `projectHolidayMap`, `addDays`)

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
2. **Normalize** start past weekends/off-days (and to the day's natural start if AM is off) —
   **only for a start the engine owns**, i.e. one derived from a prereq, or a manual start on a
   task that has effort to walk. A **manual start with no effort** is returned exactly as typed.
3. **Consume effort** day by day, taking `min(remaining, available)` until the estimate is
   spent; the final day's wall position becomes the due fraction.
- No effort and no prereqs → dates stay **manual** (whatever the user set) — *both* ends,
  start included. See "The engine only rewrites dates it owns" below.
- **Parent (group) tasks**: a task that has children is scheduled as the **rolled-up span** of
  its children — `startDate` = earliest child start, `dueDate`/`dueFraction` = the latest child
  finish. Its own estimate/start/`dependsOn` are ignored. This makes a group a valid **prereq
  anchor** (a dependent reads the span end). `planFor` carries an `inProgress` guard so a cycle
  introduced through group membership resolves to "no plan" instead of recursing forever.

## Availability = weekends ∪ member days off ∪ project holidays

`leafPlan` builds **two half-day sets** — `offAm` / `offPm` — from *both* the assignee's
`daysOff` and the project's holidays (`ProjectHolidayMap`, keyed by `projectId` so a walk
that crosses projects reads each task's own calendar). A day contributes `0` when it is a
weekend or both halves are off, `0.5` when exactly one half is, else `1`.

Two sets rather than one `0 | 0.5` number because they are what expresses the overlap:
member off in the **morning** + holiday off in the **afternoon** is a **whole** day gone, not
half. With member-only data the behaviour is byte-identical to before holidays existed.

Holidays apply to **unassigned** tasks too — they hang off `task.projectId`, not off a member.

Shared helpers, so the same rule can't be re-written three ways:
- `expandHolidaysNamed(holidays, window?)` — the ONE range→dates expansion (names, window
  clip, ISO guard, `half` judged on the original range). `expandHolidays` is its name-less
  projection for the scheduler; the UI surfaces project it differently.
- `mergeOffPart(prev, next)` — two different halves on one date make a whole day.
- `normalizeHolidays(holidays)` — the single write gate (see
  [project-holidays.md](./project-holidays.md)).
- `addDays(date, n)` — **throws** rather than returning a value past year 9999, where
  `toISOString()` switches to the expanded-year form and the result becomes its own
  successor: a day-walk that reached it used to spin forever with nothing thrown.

## Public functions
- `computeStartEnd(task, …)` — `{ startDate, dueDate }`.
- `computeWorkingPlan(task, …)` — adds `startTime`/`endTime` (e.g. `08:00`, `17:00`,
  `12:00`, `13:00`) from one pass so date & time never drift. **Views render from this.**
- `computeWorkingTimes(…)` — just the times.
- `recomputeDates(taskId)` — recompute this task and BFS-walk forward through dependents;
  idempotent (stops when nothing changes). Runs after edits to effort/start/assignee/deps.
- `recomputeAllDates()` — recompute & persist every task; heals drift; run on app load.
- Every public entry takes an optional trailing `holidays?: ProjectHolidayMap`; called
  without it they schedule exactly as they did before holidays existed.

> Transaction scope: `recomputeDates` reads `db.projects`, and Dexie requires a
> sub-transaction's tables to be a **subset** of its parent's — so every rw transaction
> containing `db.tasks` also declares `db.projects`.

## Rules & edge cases
- **The engine only rewrites dates it owns.** `recomputeAllDates()` runs on every app load and
  **persists** whatever `planFor` returns, so anything the engine "normalizes" is written to
  IndexedDB over the user's own value — silently, with no undo. The line between owned and
  manual is therefore load-bearing:
  - **Owned** — a start derived from a prereq, and an end computed from effort. Normalize
    these freely (skip weekends / off-days, lift to the day's natural start).
  - **Manual** — a start the user typed on a task with no effort, and an end on a task with
    no effort. Hand these back untouched, *even when they fall on a Sat/Sun or an off-day*.
    The date picker renders weekends **dimmed-but-selectable** ([date-picker.md](./date-picker.md)),
    so picking one is a deliberate, legal choice — not an error to correct.

  *(2026-09-21 bug: step 2 normalized unconditionally, above the `estimate <= 0` early return.
  A hand-set event on Sat Sep 5 silently became Mon Sep 7 on the next app open, with the End
  column left alone — the row looked half-edited by nobody. The original dates were gone.)*
- **Collection items are outside the engine.** A task with a `collectionId` is a dated row, not
  work — a collection has "**không scheduling**" by design ([collections.md](./collections.md)):
  its UI has no Assignee / Effort / Prereq column, and its Start/End come from one range
  picker. `planFor` returns such a task's stored dates verbatim (before the parent roll-up and
  before any off-day math), and the two recompute walks skip it. Weekends and project holidays
  are working-time concepts; a live-ops event runs on a Sunday just fine.
- A task whose end is engine-driven (has prereqs, or effort > 0) shows a **locked** date
  cell — clear the prereqs/effort to edit manually.
- Computations always derive from fresh state, never trusting a possibly-stale stored
  `dueDate`, so they're order-independent and safe to re-run.
- **Clearing effort clears the end date.** While effort > 0 the End cell is locked, so the
  stored `dueDate` under it is always a value the *engine* wrote — never something the user
  typed. Emptying the effort field therefore also nulls `dueDate` (in `updateTask`, so the
  clear is one logged edit), instead of leaving the last computed end frozen on the row: with
  no effort left to walk, `leafPlan` hands the stored value straight back and it would stick
  forever. A `dueDate` explicitly present in the same patch wins (nothing is overwritten
  behind an intentional write), and a task that never had effort keeps its manual end date.
