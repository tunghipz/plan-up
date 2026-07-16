# Persistence & backup

**Status:** Implemented
**Last updated:** 2026-07-08
**Code:** `app/src/io.ts` (`exportAll`, `importAll`, `seedIfEmpty`), `app/src/App.tsx`, `app/vite.config.ts` (`__VERCEL_ENV__`)

## Purpose
Local-first storage with no backend. Data lives in the browser's IndexedDB;
JSON export/import is the backup & transfer mechanism (not sync).

> **Per-project sharing** (export one project to a portable file, import it
> additively without wiping anything) is a sibling feature — see
> [project-export-import.md](./project-export-import.md). This doc covers the
> **full-DB backup** only.
>
> **Auto backup** (desktop app only) reuses the same `exportAll()` payload but writes
> it to a user-picked folder automatically — see [auto-backup.md](./auto-backup.md).

## User-facing behavior
- **Export → "Export all (full backup)"** (header toolbar menu): downloads
  `plan-up-YYYY-MM-DD.json` containing the whole database.
- **Import** (header toolbar): pick a `.json` file. The single Import button
  **auto-detects** the file kind — a per-project bundle (`kind: 'project'`) is added
  non-destructively (see project-export-import.md), while a **full backup (v1–5)**
  takes the destructive path below.
- Full-backup import → confirm *"Replace all data?"* → all current data is wiped and
  replaced. Success/failure feedback is an **in-DNA toast** (same slide-up toast as the
  project import), never a native `alert()` (2026-07-07 — §8 no-OS-dialog rule).
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

## Storage persistence & origin safety (2026-07-08)

Incident: after a Vercel deploy the user "lost all data" intermittently. Audit showed no
code path can wipe IndexedDB on deploy — the real causes are **origin-scoped storage**
(preview URLs / www-vs-apex are different origins with their own empty DB, which
`seedIfEmpty` then silently fills with demo data, masquerading as data loss) and
**best-effort storage eviction** (Safari ITP deletes site data after 7 days of no
interaction). Three mitigations:

1. **`navigator.storage.persist()`** on boot (`App.tsx`) — asks the browser to exempt
   the origin from storage eviction. Fire-and-forget; browsers that deny (or lack the
   API) degrade to today's behavior.
2. **Preview-deployment banner** — Vercel sets `VERCEL_ENV=preview` at build time for
   non-production deployments; `vite.config.ts` injects it as `__VERCEL_ENV__`. On a
   preview build the app shows a persistent dismissible notice: data saved on a preview
   URL lives in a separate origin from the production site. (Production deployments and
   local dev inject `''` — no banner.)
3. **Fresh-seed notice** — `seedIfEmpty()` now resolves `true` when it actually seeded
   the demo data into an empty DB. On that boot the app shows a dismissible notice
   ("started with sample data — if you had data before you may be on a different URL;
   open your usual address or import a backup") instead of seeding silently. Dismissal
   is remembered (`plan-up:seedNoticeAck` via `safeStorage`).

**Canonical domain (manual, Vercel dashboard):** keep exactly one primary domain; when
both `www.x` and `x` are assigned, Vercel redirects the secondary to the primary
automatically — verify the redirect is on so the two origins can't split user data.
Preview URLs can't be redirected (they exist on purpose); the banner covers them.

## Rules & edge cases
- Import is **replace, never merge** — by design (it's a restore, not a sync).
- `__resetSeedLockForTests()` exists for the test suite.
- `recomputeAllDates()` on load heals any stored dates that drifted under older off-day
  state — it derives from scratch and only writes rows that actually changed.
