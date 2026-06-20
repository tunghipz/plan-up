# Members & days off

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/members.tsx` (`MemberDaysOffButton`, `DateField`, `daysOffInRange`,
`effectiveDaysOff`), `app/src/SprintView.tsx` (passes per-sprint `range`),
`app/src/db.ts` (`setMemberDaysOff`, `deleteMember`, `colorForName`)

## Purpose
Members are lightweight labels you assign tasks to. Their off-days feed the scheduler so
computed dates respect real availability.

## User-facing behavior
- **Add:** "Add member" row → type a name → Enter (keeps focus for rapid entry).
- **Rename & delete:** done from the **project settings page** (gear → see
  [project-member-settings.md](./project-member-settings.md)), *not* the list view. The list
  view group header is read-mostly — it no longer carries a rename or delete affordance
  (those moved to settings to avoid two ways to do the same thing).
- **Days off:** calendar button on the group header opens a popover to add/remove off-days,
  each optionally a half-day (AM/PM). With off-days it shows a plain chip `1.5d off`; at
  rest (none in this sprint) it is an **always-visible quiet dashed "Days off" pill**
  (calendar + label, dashed border, accent on hover) — previously hover-revealed, now
  persistent so the affordance is always discoverable while staying calm.
  (Same control also lives in the settings page, `variant="metric"`.)

### Per-sprint scoping (display + entry, not data)
Off-days are real calendar dates, so each date falls inside at most one sprint's
date range. The two surfaces that show the days-off control treat scope differently:
- **Sprint view** (`MemberDaysOffButton` with a `range` prop = the sprint's
  `{ startDate, endDate }`): the popover list and the header chip count **only**
  off-days within that sprint's range (`start ≤ date ≤ end`, inclusive both ends).
  The add-day picker is **constrained** (`min`/`max` on the `<input type="date">`)
  so you can only add off-days that belong to the sprint you're viewing. Empty state:
  *"No days off this sprint."*
- **Settings page** (`variant="metric"`, no `range`): shows the **full aggregate**
  list across all sprints — the single source of truth. Empty state: *"No days off."*

This is purely a **display + entry-range** concern; there is **no per-sprint data and
no schema change**. `Member.daysOff` stays one flat list; add/update/remove are keyed
by date on that full list, and the sprint view simply filters what it renders
(`daysOffInRange(days, start, end)`) and clamps what can be added. Off-days that fall
outside every sprint's range are visible/editable only in settings.

## Data
`Member { id, projectId, name, color, daysOff: DayOff[] }`. `DayOff = { date, half? }`;
half-day = 0.5 (see [scheduling.md](./scheduling.md)).

## Implementation
- `setMemberDaysOff(memberId, daysOff)` (`db.ts:667`) — dedupes by date (last wins), drops
  malformed dates, sorts, then **recomputes every task assigned to the member** (and their
  dependents).
- `deleteMember(memberId)` (`db.ts:807`) — transactional; reassigns the member's tasks to
  `assigneeId = null`.
- `colorForName(name)` (`db.ts:199`) — deterministic 8-color palette by name hash.
- Avatar = colored circle with the uppercased first letter.

## Rules & edge cases
- **Nested calendar / outside-click (2026-06-20 fix):** the add-day `DateField` opens a
  `CalendarPopover` that is **portaled to `<body>`**, so it sits outside the days-off
  popover's `popRef`. The popover's `document` `mousedown` outside-click handler therefore
  treated a calendar-day click as "outside" and closed the popover *on mousedown*, unmounting
  the calendar before the day's `onClick` fired — so a day off could never be picked. Fix:
  the calendar portal is marked `data-calendar-popover` and the days-off handler ignores
  mousedowns inside `[data-calendar-popover]`. (`members.tsx`, `DatePicker.tsx`.)
- Off-day changes re-run scheduling immediately, so dates shift the moment availability
  changes.
- Half-day AM vs PM is labeled for humans but both count 0.5 toward effort.
- Per-sprint scoping never affects the scheduler: a member off on a date is off in
  every computation regardless of which view edited it. The scheduler always reads the
  full `daysOff`.
- `daysOffInRange(days, start, end)` is a pure helper (inclusive bounds) — unit-tested
  independently of React.
