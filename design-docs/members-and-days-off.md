# Members & days off

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/SprintView.tsx` (`Avatar`, `AddMemberRow`, `MemberScheduleButton`),
`app/src/db.ts` (`setMemberDaysOff`, `deleteMember`, `colorForName`)

## Purpose
Members are lightweight labels you assign tasks to. Their off-days feed the scheduler so
computed dates respect real availability.

## User-facing behavior
- **Add:** "Add member" row → type a name → Enter (keeps focus for rapid entry).
- **Rename:** double-click a member's name in its group header.
- **Delete:** trash icon on the group header → their tasks become **Unassigned** (not
  deleted).
- **Days off:** calendar button on the group header opens a popover to add/remove off-days,
  each optionally a half-day (AM/PM). The header chip shows effective days, e.g. `1.5d off`.

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
- Off-day changes re-run scheduling immediately, so dates shift the moment availability
  changes.
- Half-day AM vs PM is labeled for humans but both count 0.5 toward effort.
