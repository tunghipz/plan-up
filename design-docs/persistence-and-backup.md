# Persistence & backup

**Status:** Implemented
**Last updated:** 2026-06-30 (server-primary snapshot added)
**Code:** `app/src/db.ts` (`exportAll`, `importAll`, `seedIfEmpty`), `app/src/App.tsx`, `app/src/server-sync.ts`, `app/server/openai-gateway.mjs`

## Purpose
Server-primary storage with a Dexie client cache. When the app is served by the
plan-up gateway, the server owns the canonical full JSON snapshot and the
browser's IndexedDB is hydrated from that snapshot on startup. JSON export/import
remains the manual backup & transfer mechanism.

> **Per-project sharing** (export one project to a portable file, import it
> additively without wiping anything) is a sibling feature — see
> [project-export-import.md](./project-export-import.md). This doc covers the
> **full-DB backup** only.

## User-facing behavior
- On app startup over HTTP(S), the browser fetches `/api/db/snapshot`. If the
  server has a snapshot, it replaces the local Dexie cache before project data
  renders.
- If the server has no snapshot yet, first launch uses the existing seed path
  and then writes the first full snapshot to the server.
- After local changes, the app debounces and uploads the latest full snapshot to
  the server. See [server-handoff.md](./server-handoff.md).
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
Touches every table. Export payload (`ExportPayload`, `db.ts:817`):
```jsonc
{ "version": 5, "exportedAt": "<ISO>", "projects": [], "members": [], "sprints": [], "collections": [], "tasks": [], "events": [], "aiThreads": [], "aiMessages": [] }
```

## Implementation
- `exportAll()` — snapshot of all exportable tables, `version: 5`.
- `importAll(payload)` (`db.ts:844`) — **replace semantics**: clears all tables, then
  bulk-adds. Accepts v1 (pre-multi-project, no `projects`) through v5. Backfills on
  import: synthesize default project for v1, `daysOff` `string[]`→`DayOff[]`,
  per-project `sequence` (by `createdAt`), `startDate ?? null`, `dependsOn ?? []`.
- `seedIfEmpty()` (`db.ts:920`) — module-level promise **lock** so React StrictMode's
  double-mount can't seed twice. `seedFresh` creates 3 demo members, one "Sprint 1"
  (14 days from today), and a welcome task.
- App load (`App.tsx`) runs server snapshot import when available, otherwise
  `seedIfEmpty()`, then `dedupeSprints()` → `recomputeAllDates()`.

## Rules & edge cases
- Import is **replace, never merge** — by design (it's a restore, not a sync).
- Server snapshot import is also replace semantics. When the gateway has a
  snapshot, server data wins over stale browser cache on startup.
- `__resetSeedLockForTests()` exists for the test suite.
- `recomputeAllDates()` on load heals any stored dates that drifted under older off-day
  state — it derives from scratch and only writes rows that actually changed.
