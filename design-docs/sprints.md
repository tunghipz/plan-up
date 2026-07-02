# Sprints

**Status:** Implemented
**Last updated:** 2026-07-02 (sprint creation is a canonical `createSprint()` in the data
layer — row + `sprint_started` event commit in one transaction)
**Code:** `app/src/App.tsx` (`NewSprintDialog`, `SprintNoteBanner`, sprint panel,
`SprintStateDot`, `renderSprintRow`), `app/src/db.ts` (`createSprint`, `nextSequence`,
`setSprintNote`), `app/src/lib.ts` (`sprintTemporalState`; tests in `sprint-cadence.test.ts`)

## Purpose
A sprint is the time-boxed folder tasks live in. Biweekly by default, with a clean
per-sprint task numbering. Its **name is automatic and fixed** (`Sprint N`); free-text
context lives in an **optional note** instead.

## User-facing behavior
- **Create:** `+` next to "Sprints" or the `n` shortcut → `NewSprintDialog`. The **name is
  shown locked** (`Sprint N`, read-only with a lock glyph — not an input); the editable
  fields are **Start**, **End**, and an optional **note**. Enter or **Create** to save; it
  becomes the current sprint. Creation goes through the canonical **`createSprint()`**
  (`db.ts`): the sprint row and its `sprint_started` activity event commit in **one
  transaction**, so a crash between them can't leave a sprint with no birth entry
  (seeding logs no event by design). See
  [sprint-activity-log.md](./sprint-activity-log.md).
- **Select:** click a row in the sprint panel (active row = accent bg, shows date range +
  task count; a small note glyph appears **trailing at the row's right edge** when the sprint
  has a note — kept off the title so the name stays clean; faint at rest, white/80 on the
  selected accent row).
- **State glyph (leading dot):** each sprint row's leading glyph encodes its **temporal
  state** — derived from today vs the sprint's locked window (`sprintTemporalState` in
  `lib.ts`), not from selection. Three states, using only existing status tokens (no new
  colour — see design-system §2.3):
  - **Upcoming** (`today < startDate`) — a **hollow ring**, `--color-status-todo` grey. Not started.
  - **In progress / đang diễn ra** (`startDate ≤ today ≤ endDate`) — a **filled accent dot
    inside a soft accent halo** (the one "live" sprint), `--color-accent`.
  - **Past / đã qua** (`today > endDate`) — a **solid muted dot**, `--color-status-todo` grey;
    flips to **`--color-status-done` green** when every task is done (`done === total > 0`).
  - On the **selected** row (accent bg) the same shapes render in white/translucent-white, so
    state stays legible while the row is highlighted. The glyph is `aria-hidden` (state is
    conveyed by the date range text too). The "live" halo has a calm 2s pulse.
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
Start is **locked to a Monday** and length is a **fixed 2 weeks** (ClickUp-style) — see
[sprint-cadence.md](./sprint-cadence.md). Computed once on open via
`defaultSprintDates()` (`lib.ts`):
- **Start** = first Monday after the last sprint's `endDate` (back-to-back; forward-snaps
  a legacy mid-week end), else the **current week's Monday**. Picked from a **Monday-strip**
  of upcoming Mondays — not a free date field.
- **End** = derived `start + 13` days (always a Sunday); shown read-only as a range line +
  "2 weeks" badge, no picker.
- **Name** = increment the trailing number of the last sprint's name (`Sprint N`), else
  `Sprint <count+1>`. Shown locked (not editable).

## Data
`Sprint { id, projectId, name, startDate, endDate, note? }`.
- `note?` is an **optional, non-indexed** string → **no Dexie version bump** (same pattern
  as `Project.description`; rows without it read as empty). Written only through
  `setSprintNote()`; trimmed empty → field cleared.
- Date range rendered with `formatSprintRange` → `MMM d → MMM d` (arrow, month on both
  sides, e.g. `May 18 → May 31`).

## Migration of legacy custom names
Existing sprints that were manually renamed **keep their stored name** (displayed as-is) —
locking only removes the rename UI, it does **not** renumber or overwrite history. Only
newly created sprints are guaranteed `Sprint N`. (Decision 2026-06-12.)

## Per-sprint sequence
`Task.sequence` is unique **within a sprint**, starting at 1 (schema v8). New tasks get
`nextSequence(sprintId)` = current max + 1 (`db.ts:206`); numbers are never reused inside
a sprint. Moving a task across sprints renumbers it — see
[sprint-rollover.md](./sprint-rollover.md).

## Archiving
Sprints can be **archived** (reversible hide) to declutter a long list — they drop into a
collapsible `Archived (N)` section and leave the active flow (new-sprint default, rollover
target, auto-select, `Sprint N` numbering). Spec: [sprint-archive.md](./sprint-archive.md).

## Rules & edge cases
- Reopening `NewSprintDialog` without creating keeps the same suggestion (memoized).
- Current sprint isn't persisted across sessions (defaults to the latest by `startDate`).
- `dedupeSprints()` merges accidental same-name duplicates within a project (legacy
  cleanup) — also renumbers on merge.
