# Sprints

**Status:** Implemented
**Last updated:** 2026-06-12
**Code:** `app/src/App.tsx` (`NewSprintDialog`, `SprintNoteBanner`, sprint panel),
`app/src/db.ts` (`nextSequence`, `setSprintNote`)

## Purpose
A sprint is the time-boxed folder tasks live in. Biweekly by default, with a clean
per-sprint task numbering. Its **name is automatic and fixed** (`Sprint N`); free-text
context lives in an **optional note** instead.

## User-facing behavior
- **Create:** `+` next to "Sprints" or the `n` shortcut → `NewSprintDialog`. The **name is
  shown locked** (`Sprint N`, read-only with a lock glyph — not an input); the editable
  fields are **Start**, **End**, and an optional **note**. Enter or **Create** to save; it
  becomes the current sprint.
- **Select:** click a row in the sprint panel (active row = accent bg, shows date range +
  task count; a small note glyph appears **trailing at the row's right edge** when the sprint
  has a note — kept off the title so the name stays clean; faint at rest, white/80 on the
  selected accent row).
- **Name is not editable.** There is no rename affordance anywhere — the header title is
  plain locked text. (Removed the old `SprintNameEditor` inline rename.)
- **Note (optional):** a sprint-goal line shown in a thin **goal banner** beneath the
  header (Solution B). Click the banner text to edit inline (multi-line; `⌘`+Enter or blur
  commits, Escape cancels). When empty, the banner collapses to a calm dashed
  **`+ Add sprint note`** slot (`AddGroupButton` idiom, §5.11) so it stays quiet until used.

## Why lock the name
Custom sprint names drift (`Sprint 12`, `Payments`, `wk of Jun 2`…) and break the clean
`Sprint N` ordering the rollover/dedupe logic leans on. Locking the name keeps identity
boringly consistent; the **note** carries the "what is this sprint about" that naming used
to (badly) carry. One-click speed: name needs zero input on create.

## Biweekly defaults (`NewSprintDialog`)
Computed once on open:
- **Start** = day after the last sprint's `endDate` (back-to-back), else today.
- **End** = start + 13 days (14-day sprint).
- **Name** = increment the trailing number of the last sprint's name (`Sprint N`), else
  `Sprint <count+1>`. Shown locked (not editable).

## Data
`Sprint { id, projectId, name, startDate, endDate, note? }`.
- `note?` is an **optional, non-indexed** string → **no Dexie version bump** (same pattern
  as `Project.description`; rows without it read as empty). Written only through
  `setSprintNote()`; trimmed empty → field cleared.
- Date range rendered with `formatSprintRange` → `MMM d – d` (same month) or `MMM d – MMM d`.

## Migration of legacy custom names
Existing sprints that were manually renamed **keep their stored name** (displayed as-is) —
locking only removes the rename UI, it does **not** renumber or overwrite history. Only
newly created sprints are guaranteed `Sprint N`. (Decision 2026-06-12.)

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
