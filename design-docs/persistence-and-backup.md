# Persistence & backup

**Status:** Implemented
**Last updated:** 2026-06-19
**Code:** `app/src/db.ts` (`exportAll`, `importAll`, `seedIfEmpty`), `app/src/App.tsx`

## Purpose
Local-first storage with no backend. Data lives in the browser's IndexedDB;
JSON export/import is the backup & transfer mechanism (not sync).

> **Per-project sharing** (export one project to a portable file, import it
> additively without wiping anything) is a sibling feature — see
> [project-export-import.md](./project-export-import.md). This doc covers the
> **full-DB backup** only.

## User-facing behavior
- **Export → "Export all (full backup)"** (header toolbar menu): downloads
  `plan-up-YYYY-MM-DD.json` containing the whole database.
- **Import** (header toolbar): pick a `.json` file. The single Import button
  **auto-detects** the file kind — a per-project bundle (`kind: 'project'`) is added
  non-destructively (see project-export-import.md), while a **full backup (v1–4)**
  takes the destructive path below.
- Full-backup import → confirm *"Replace all data?"* → all current data is wiped and
  replaced. Success alert: *"Import successful."*
- First launch with an empty DB seeds a demo project (see Seeding).

## Data
Touches every table. Export payload (`ExportPayload`, `db.ts:817`):
```jsonc
{ "version": 2, "exportedAt": "<ISO>", "projects": [], "members": [], "sprints": [], "tasks": [] }
```

## Implementation
- `exportAll()` (`db.ts:827`) — snapshot of all tables, `version: 2`.
- `importAll(payload)` (`db.ts:844`) — **replace semantics**: clears all tables, then
  bulk-adds. Accepts v1 (pre-multi-project, no `projects`) and v2. Backfills on import:
  synthesize default project for v1, `daysOff` `string[]`→`DayOff[]`, per-project
  `sequence` (by `createdAt`), `startDate ?? null`, `dependsOn ?? []`.
- `seedIfEmpty()` (`db.ts:920`) — module-level promise **lock** so React StrictMode's
  double-mount can't seed twice. `seedFresh` creates 3 demo members, one "Sprint 1"
  (14 days from today), and a welcome task.
- App load (`App.tsx`) runs `seedIfEmpty()` → `dedupeSprints()` → `recomputeAllDates()`.

## Rules & edge cases
- Import is **replace, never merge** — by design (it's a restore, not a sync).
- `__resetSeedLockForTests()` exists for the test suite.
- `recomputeAllDates()` on load heals any stored dates that drifted under older off-day
  state — it derives from scratch and only writes rows that actually changed.
