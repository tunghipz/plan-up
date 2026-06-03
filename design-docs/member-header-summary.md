# Member header summary

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `AvatarRing`, `MemberStatsBar`,
`MemberScheduleButton`, `effectiveDaysOff`)

## Purpose
Tell the manager, at a glance per assignee: how far along, what's late, when the next
deadline is, and how much time off they have — without opening anything.

## User-facing behavior
The member group header shows, left → right:
- **Progress ring** around the avatar — green arc = % of the member's tasks done
  (3px arc, Activity-ring look). Center shows the avatar.
- **`done/total`** count (e.g. `3/7`).
- **Overdue chip** (red, soft-tint) — *only when > 0*, e.g. `1 overdue`.
- **Next deadline** (muted) — `due Jun 10`: the earliest upcoming end date among unfinished
  tasks. Hidden when there's none.
- **Days off** (calendar) — effective days, e.g. `1.5d off`; click opens the day-off
  popover.

## Data
Derived entirely from the member's `tasks` + `member.daysOff` — **no extra DB fields**.

## Implementation
All computed in `MemberCard` from each task's **computed plan** (`computeWorkingPlan`), so
the header agrees with the End column:
- `pct = round(done/total*100)`.
- `overdue` = count of not-done tasks whose computed due is in the past.
- `nextDue` = earliest not-done computed due that is today-or-later.
- `effectiveDaysOff(daysOff)` sums `0.5` per half-day, else `1`.
`MemberStatsBar` renders overdue (conditional) + `due <date>` (conditional);
`AvatarRing` draws the conic-gradient ring; `MemberScheduleButton` shows `Nd off`.

## Rules & edge cases
- Overdue (past) and next-deadline (future) never overlap — overdue owns the past.
- A fully-done member shows just a full ring + `N/N` — no overdue, no due (calm).
- "Next deadline" replaced an earlier "remaining workload (`Nd left`)" metric, which read
  as too abstract.
