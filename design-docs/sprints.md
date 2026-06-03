# Sprints

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/App.tsx` (`NewSprintDialog`, `SprintNameEditor`, sprint panel),
`app/src/db.ts` (`nextSequence`)

## Purpose
A sprint is the time-boxed folder tasks live in. Biweekly by default, with a clean
per-sprint task numbering.

## User-facing behavior
- **Create:** `+` next to "Sprints" or the `n` shortcut → `NewSprintDialog` with Name,
  Start, End. Defaults are suggested (see below). Enter or **Create** to save; it becomes
  the current sprint.
- **Select:** click a row in the sprint panel (active row = accent bg, shows date range +
  task count).
- **Rename:** double-click the sprint name in the header (or its pencil) → inline edit;
  Enter/blur commits, Escape cancels.

## Biweekly defaults (`NewSprintDialog`)
Computed once on open:
- **Start** = day after the last sprint's `endDate` (back-to-back), else today.
- **End** = start + 13 days (14-day sprint).
- **Name** = increment the trailing number of the last sprint's name (`Sprint N`), else
  `Sprint <count+1>`.

## Data
`Sprint { id, projectId, name, startDate, endDate }`. Date range rendered with
`formatSprintRange` → `MMM d – d` (same month) or `MMM d – MMM d`.

## Per-sprint sequence
`Task.sequence` is unique **within a sprint**, starting at 1 (schema v8). New tasks get
`nextSequence(sprintId)` = current max + 1 (`db.ts:206`); numbers are never reused inside
a sprint. Moving a task across sprints renumbers it — see
[sprint-rollover.md](./sprint-rollover.md).

## Rules & edge cases
- Reopening `NewSprintDialog` without creating keeps the same suggestion (memoized).
- Current sprint isn't persisted across sessions (defaults to the latest by `startDate`).
- `dedupeSprints()` merges accidental same-name duplicates within a project (legacy
  cleanup) — also renumbers on merge.
