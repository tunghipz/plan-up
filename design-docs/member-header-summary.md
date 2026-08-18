# Member header summary

**Status:** Implemented
**Last updated:** 2026-08-18 (+ chip `Nd holiday`)
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `AvatarRing`, `MemberStatsBar`),
`app/src/members.tsx` (`MemberDaysOffButton`),
`app/src/lib.ts` (`effectiveDaysOff`, `holidayLoadInSpan`, `memberTaskSpan`)

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
- **Holiday chip** (text only, no icon — a second calendar glyph beside the days-off one read
  as one repeated control; dimmed, no border) — `3d holiday`, *only when a project
  holiday overlaps this member's task span*. Counts working days lost inside the overlap.
  Click opens the same day-off popover (holidays are listed there, read-only). See
  [project-holidays.md](./project-holidays.md).
- **Days off** (calendar) — effective **personal** days, e.g. `1.5d off`; click opens the
  day-off popover. Project holidays are not counted here — they get their own chip.

## Data
Derived entirely from the member's `tasks` + `member.daysOff` — **no extra DB fields**.

## Implementation
All computed in `MemberCard` from each task's **computed plan** (`computeWorkingPlan`), so
the header agrees with the End column:
- `pct = round(done/total*100)`.
- `overdue` = count of not-done tasks whose computed due is in the past.
- `nextDue` = earliest not-done computed due that is today-or-later.
- `memberTaskSpan(tasks, planById)` (`lib.ts`) = the member's earliest computed start …
  latest computed due (a milestone contributes its date once; no tasks ⇒ null). It feeds both
  the days-off window and the holiday chip, so a wrong span would quietly change every chip —
  it lives in `lib.ts` with tests rather than inline in `MemberCard`.
- `effectiveDaysOff(daysOff)` sums `0.5` per half-day, else `1`.
`MemberStatsBar` renders overdue (conditional) + `due <date>` (conditional);
`AvatarRing` draws the conic-gradient ring; `MemberDaysOffButton` shows `Nd off` and,
when `taskSpan` is passed and a holiday intersects it, the `Nd holiday` chip
(`holidayLoadInSpan` in `lib.ts`).

## Rules & edge cases
- Overdue (past) and next-deadline (future) never overlap — overdue owns the past.
- A fully-done member shows just a full ring + `N/N` — no overdue, no due (calm).
- "Next deadline" replaced an earlier "remaining workload (`Nd left`)" metric, which read
  as too abstract.
