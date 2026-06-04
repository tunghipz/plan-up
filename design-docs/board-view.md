# Board view

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/BoardView.tsx`

## Purpose
A calm, glanceable kanban for the sprint — "where is everything" at a status level.
Read-mostly; deep editing stays in the list view.

## User-facing behavior
- Three columns on the grey canvas: **To do · In progress · Done** (the `STATUS_ORDER`),
  each with the status icon, label, and a count.
- **Cards** (white, large-radius, soft shadow) show: status circle (click to cycle status),
  title, `#sequence`, priority tag (urgent/high only), a due chip, and the assignee avatar.
- **Due chip** is color-coded by urgency: done → green; overdue → red; within 3 days →
  orange; else faint. Soft-tinted via tokens (dark-safe).
- Search filters cards by title (see [search-and-keyboard.md](./search-and-keyboard.md)).

## Data
Reads the current sprint's `tasks` (passed in) + the project's `members` (for avatars).
The only mutation is status (`db.tasks.update` on cycle).

## Implementation
- `byStatus` buckets filtered tasks; within a column, **Done sorts by sequence desc**
  (most-recently-finished feel), others **asc**.
- `cycleStatus` advances `todo → in_progress → done → todo`.
- Reuses `STATUS_META` / `STATUS_ORDER` / `StatusIcon` from `SprintView.tsx`.

## Rules & edge cases
- Board is intentionally minimal — no inline date/effort/prereq editing (that's the list).
- Active view persisted at `localStorage['plan-up:view']`.
