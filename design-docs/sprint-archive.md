# Sprint archive

**Status:** Implemented (2026-06-19)
**Last updated:** 2026-06-19 (archived demoted from a peer section to an inline
disclosure *inside* the Sprints group — see Hierarchy below)
**Code:** `app/src/lib.ts` (`latestActiveSprint`, `nextSprintNumber`, `sprintToSelect`;
tests in `sprint-archive.test.ts`), `app/src/db.ts` (`Sprint.archivedAt`,
`setSprintArchived`, `ActivityKind`, rollover target filter), `app/src/App.tsx`
(`renderSprintRow`, active/archived split, inline `Show N archived` disclosure, active-flow wiring),
`app/src/ActivityLog.tsx` (event rendering)
**Related:** [sprints.md](./sprints.md), [sprint-cadence.md](./sprint-cadence.md),
[sprint-rollover.md](./sprint-rollover.md), [data-model.md](./data-model.md),
[sprint-activity-log.md](./sprint-activity-log.md)

## Purpose
Sprints accumulate forever (there's no delete), so the panel's Sprints list grows
unbounded and old sprints crowd out the ones you actually work in. **Archive** is a
reversible "move out of the way" — it hides a sprint from the active list behind a quiet
**`Show N archived`** disclosure at the foot of the Sprints list, keeping all its
tasks/data intact and one click from return. It's the gentle alternative to delete
(which plan-up deliberately doesn't have).

## Hierarchy — archived belongs to Sprints (decided 2026-06-19)
Archived sprints are a *sub-set of Sprints*, not a feature peer of Sprints/Collections.
The sidebar must read that way: **one Sprints group** (header + active list + archived)
and **Collections** as its only peer.

Earlier the archived list rendered as an `Archived (N)` row with the *same* recipe as the
Sprints and Collections headers (same indent, `text-[12px] font-semibold text-ink-faint`,
chevron + count) and near-even vertical rhythm — so all three read as flat peers. Fixed by
the **inline-disclosure** treatment (Apple Reminders' "Show Completed" pattern): archived
lives *inside* the Sprints list as a ghost text toggle, never a section header. The group
break before Collections is then the largest gap in the panel, and within-group spacing
(active rows → disclosure) is tighter — so proximity alone communicates the parent/child.

## User-facing behavior
- **Archive a sprint:** hover a sprint row → a quiet **archive icon** appears at the
  row's right edge (same hover idiom as the inline-rename ✎). Click → the sprint drops
  into the Archived section. Calm at rest (icon hidden), accent on hover. (Works on the
  current sprint too, so there's no separate header affordance — see Future.)
  - **Note glyph placement:** the "has a note" glyph hugs the **title text** (right after
    the name), not the row's right edge — so it never collides with the hover archive
    action sitting at the edge. (Fixed 2026-06-19; the name span dropped `flex-1`.)
- **`Show N archived` disclosure:** at the foot of the active Sprints list (inside the
  Sprints group, not a peer header), a quiet ghost toggle — muted text + small chevron,
  indented to sit under the sprint rows. **Collapsed by default** (label `Show N archived`);
  click to expand (label `Hide archived`, chevron down) → archived rows reveal *indented*
  directly below it. Collapse state is remembered (localStorage
  `plan-up:sidebarArchivedCollapsed`). The disclosure (and rows) collapse together with the
  Sprints section, and are hidden entirely when N = 0.
- **Archived rows** read like active rows (name + `MMM d → MMM d` range + task count) but
  muted, with an **`archived {MMM d}`** caption (when it was archived). Hover → an
  **unarchive** icon returns it to the active list.
- **Selecting an archived sprint** still works (click to open and view/edit its tasks) —
  archive only changes *where it's listed*, not whether it's reachable.

## Active-flow exclusion (decided 2026-06-19)
Archived sprints are **out of the active flow** — every "which sprint is current/next"
computation considers only **non-archived** sprints:
- **Auto-select latest:** on project load / when the current sprint is gone, default to
  the latest **non-archived** sprint (App.tsx ~L301). If *all* are archived, fall back to
  the latest archived (so the app never shows an empty task view).
- **New-sprint default (back-to-back):** `defaultSprintDates(lastEnd, …)` takes the latest
  **non-archived** sprint's `endDate` (see [sprint-cadence.md](./sprint-cadence.md)).
- **`Sprint N` numbering:** increment from the highest **non-archived** `Sprint N` (and
  guard the global max so a number is never reused even if an archived sprint held it).
- **Rollover target:** the "next sprint" rollover moves into is the next **non-archived**
  sprint; archived sprints are never rollover targets
  (see [sprint-rollover.md](./sprint-rollover.md)).

## Data
Add an optional **`archivedAt?: number`** (epoch ms) to `Sprint` — set when archived,
cleared (field deleted) when unarchived. `archived = archivedAt != null`.
- **Optional, non-indexed → no Dexie version bump** (same pattern as `Sprint.note?` and
  `Project.description`; rows without it read as active). Filtering active vs archived is
  in-memory (a project has few sprints). See [data-model.md](./data-model.md).
- Written only through **`setSprintArchived(sprintId, archived: boolean)`** in `db.ts`
  (sets/clears `archivedAt`, writes the activity-log event).

## Activity log
Archiving is a sprint-level history event (plan-up's events table already records
`sprint_started` / `rolled_over`). Extend `ActivityKind` with **`sprint_archived`** and
**`sprint_unarchived`**; `setSprintArchived` appends one (taskId null, sprint-level).
`ActivityLog.tsx` renders an icon + label for each (e.g. `Archive` / `ArchiveRestore`
lucide glyphs, `--color-ink-muted`). History starts when the feature ships (no backfill).

## Implementation notes
- `db.ts`: `archivedAt?` on the `Sprint` type; `setSprintArchived(id, archived)`;
  extend `ActivityKind`; the function logs via the existing `logEvent` path.
- `App.tsx` sprint panel: split `sprints` into `active` / `archived` by `archivedAt`.
  Render the active list as today, then (if `archived.length`) the inline `Show N archived`
  disclosure **inside** the Sprints list block (so it collapses with the section), reusing
  `archivedCollapsed` / `toggleArchivedCollapsed`. Expanded → archived rows indented below.
  Add the hover archive/unarchive control to the row (guard: hidden on scroll-locked states,
  shown on `group/row` hover like the date-cell pills).
- Active-flow helpers: update the auto-select effect, the `lastSprint` passed to
  `NewSprintDialog`, and the rollover target lookup to filter `archivedAt == null`.
- `ActivityLog.tsx`: icon + label for the two new kinds.

## Rules & edge cases
- **Archiving the current sprint:** allowed; after archiving, auto-select the latest
  non-archived sprint (or the just-archived one if it was the last active one — never a
  blank view).
- **All sprints archived:** the active list shows its `All sprints archived` empty state,
  with the `Show N archived` disclosure right below it; the app still opens the latest
  by `startDate` so there's always a task view.
- **Numbering safety:** new `Sprint N` must not collide with an archived sprint's number —
  increment from the global max name number, not just the active max.
- **Archived excluded from capacity/summary** of the active view (they're not "current").
- **No bulk / auto-archive** in this version (manual only) — see Future.

## Future / open questions
- **Auto-archive suggestion:** optionally nudge to archive sprints that are fully done and
  ended > N weeks ago (with undo). Deferred — manual only for now to avoid archiving
  things the user didn't ask to hide.
- **Bulk archive** ("archive all completed before {date}") if the manual flow proves
  tedious at scale.
- **Header archive affordance:** a dedicated archive action in the open sprint's header.
  Not built — the row hover action already covers the current sprint. Add only if users
  expect it where they're looking.
