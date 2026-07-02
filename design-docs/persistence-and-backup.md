# Persistence & backup

**Status:** Implemented
**Last updated:** 2026-07-02
**Code:** `app/src/io.ts` (`exportAll`, `importAll`, `seedIfEmpty`), `app/src/App.tsx`

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
  non-destructively (see project-export-import.md), while a **full backup (v1–5)**
  takes the destructive path below.
- Full-backup import → confirm *"Replace all data?"* → all current data is wiped and
  replaced. Success alert: *"Import successful."*
- First launch with an empty DB seeds a demo project (see Seeding).

## Data
Touches every table. Export payload (`ExportPayload`, `io.ts`), **version 5**:
```jsonc
{ "version": 5, "exportedAt": "<ISO>", "projects": [], "members": [], "sprints": [],
  "collections": [], "tasks": [], "events": [], "people": [] }
```
Version history: v1 pre-multi-project (no `projects`) · v2 `projects` · v3 `collections`
· v4 `events` (sprint activity log) · **v5 `people`** (cross-project People identity —
without it a restore would rebuild people from member names, silently undoing merges,
renames and colors).

## Implementation
- `exportAll()` (`io.ts`) — snapshot of all tables (incl. `people`), `version: 5`.
- `importAll(payload)` (`io.ts`) — **replace semantics**: clears all tables, then
  bulk-adds. Accepts v1–v5. Backfills on import:
  synthesize default project for v1, `daysOff` `string[]`→`DayOff[]`, per-project
  `sequence` (by `createdAt`), `startDate ?? null`, `dependsOn ?? []`.
- **People round-trip (v5+):** `people` are restored **verbatim**, so merges, renames and
  colors survive export → import. Members keep their `personId` links; a **dangling**
  `member.personId` (hand-edited / truncated file) is re-linked to an existing person by
  **normalized name**, else a fresh person is synthesized — every member ends up linked
  either way. **Pre-v5 payloads** carry no `people`: they are rebuilt from the imported
  member names (grouped by normalized name, so a person recurring across projects
  re-unifies) — the same backfill as the v13 schema upgrade.
- The pre-clear shape guard also rejects a payload whose `people` field is present but
  **not an array** (same reject-before-wipe rule as the other tables).
- `seedIfEmpty()` (`io.ts`) — module-level promise **lock** so React StrictMode's
  double-mount can't seed twice. `seedFresh` creates 3 demo members, one "Sprint 1"
  (14 days from today), and a welcome task.
- App load (`App.tsx`) runs `seedIfEmpty()` → `dedupeSprints()` → `recomputeAllDates()`.

## Rules & edge cases
- Import is **replace, never merge** — by design (it's a restore, not a sync).
- `__resetSeedLockForTests()` exists for the test suite.
- `recomputeAllDates()` on load heals any stored dates that drifted under older off-day
  state — it derives from scratch and only writes rows that actually changed.
