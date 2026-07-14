# Auto backup (desktop only)

**Status:** Implemented
**Last updated:** 2026-07-14 (**two-tier backup** — the daily rolling file is kept,
**plus an append-only `versions/` subfolder** of immutable timestamped snapshots so
a same-day bad edit no longer clobbers the last good state; per-run writes are
**deduped** by content hash; `versions/` keeps the newest 200. Requires a new
desktop build — the Rust filename guard + commands changed.)
**Code:** `app/src/backup.ts`, `app/src/backup-tauri.ts`, `app/src/BackupSettingsModal.tsx`, `app/src-tauri/src/lib.rs`, `app/src/App.tsx`

## Purpose
IndexedDB is the only home of the data; a container reset or accidental "Replace all"
loses everything since the last manual export. In the desktop (Tauri) build the app
can write real files, so: pick a folder once, and the app silently keeps full-backup
JSON there whenever data changes. Desktop-only — a browser cannot write to an
arbitrary folder unattended.

**Two tiers** (2026-07-14): a **daily rolling file** (`plan-up-YYYY-MM-DD.json`,
overwritten in place — the fast "restore latest" path) *and* an **append-only
`versions/` subfolder** of **immutable** timestamped snapshots
(`plan-up-YYYY-MM-DD-HHMMSS.json`). The daily file alone meant a bad edit + the
30 s auto-run would overwrite the last good same-day state (rollback only reached
yesterday); the `versions/` tier keeps every distinct state so you can roll back to
any point, not just the last one per day.

> Sibling of the manual **Export all** flow — see
> [persistence-and-backup.md](./persistence-and-backup.md). Same payload
> (`exportAll()`, v5), different trigger and destination. Restoring a backup file
> uses the normal Import button.

## User-facing behavior
- Export menu (header) gains an **"Auto backup…"** item — only in the desktop app.
- Modal (ModalSheet): enable/disable toggle · chosen folder path + "Choose folder…"
  (native directory picker; picking a folder when none was set also enables) ·
  **Back up now** button · last-backup status line (green "Last backup <time> →
  <file>" or red error message) · caption "Keeps 30 daily files + 200 versions/".
- With backup enabled + folder chosen: any data change → after **30 s of quiet** the
  app (1) writes `plan-up-YYYY-MM-DD.json` (local date) into the folder, **overwriting
  the same-day file**, and prunes to the **newest 30** daily files; (2) unless the
  payload is byte-identical to the last snapshot (dedup), also writes an immutable
  `versions/plan-up-YYYY-MM-DD-HHMMSS.json` and prunes `versions/` to the **newest 200**.
- Failures (folder deleted, unwritable) never interrupt the app — the status line in
  the modal turns red with the OS error; re-pick the folder to fix.
- **Restore** stays the normal **Import** button — the user picks either the daily
  file or any file from `versions/`; both are plain full-export JSON. (An in-app
  "restore which version" picker is a Future item — see below.)

## Data
Reads every table via `exportAll()` (io.ts) — payload identical to manual full export.
Writes nothing to the DB. Settings live in localStorage:
`plan-up:backupDir` (path), `plan-up:backupEnabled` (`'1'`),
`plan-up:backupLast` (JSON `BackupStatus {at, ok, file?, error?}`),
`plan-up:backupHash` (last snapshot's dedup hash — see below).

## Implementation
- **Change detection** (`startAutoBackup`, backup-tauri.ts): Dexie `liveQuery`
  subscribing `count()` on all 7 tables — any write to any table re-emits (same
  invalidation machinery the `useLiveQuery` views use). The first emission (fired on
  subscribe) is skipped; each later one arms the scheduler. Started from an App.tsx
  mount effect; returns a disposer (StrictMode-safe).
- **`BackupScheduler`** (backup.ts, pure): trailing-edge 30 s debounce; changes
  arriving while a run is in flight re-arm it; `notify()` never throws; `dispose()`
  cancels. Fully unit-tested with fake timers.
- **`runBackupNow()`** (backup-tauri.ts): guards (Tauri + folder set + enabled or
  explicit user click) → `exportAll()` → `contents = JSON.stringify(payload)`. Then:
  1. **Daily tier** — `write_backup(dir, dailyName, contents)` + `prune_backups(dir,
     {keep: BACKUP_KEEP=30})` (main folder, no subdir).
  2. **Versions tier** — compute a **dedup hash** over the payload *with `exportedAt`
     stripped* (that field changes every call, so hashing raw contents would never
     match). If it differs from `plan-up:backupHash`: `write_backup(dir, versionName,
     contents, {subdir: 'versions'})` + `prune_backups(dir, {keep:
     VERSIONS_KEEP=200, subdir: 'versions'})`, then persist the new hash. Identical
     payload → skip the version write (the daily file already reflects it).
  - Persists `BackupStatus` (with the daily filename). All errors caught into
    `{ok:false, error}` — never thrown. Status stays `ok` even when the version write
    was skipped by dedup.
- **Filenames** (backup.ts): `backupFilename(date)` → `plan-up-YYYY-MM-DD.json`;
  `versionFilename(date)` → `plan-up-YYYY-MM-DD-HHMMSS.json`. Both use **local** date
  parts (the manual export slices UTC `exportedAt` — deliberate difference: "today's
  file" should follow the user's clock).
- **Dedup hash**: `hashString(s)` — tiny non-crypto FNV-1a, only needs to detect
  "same payload as last run". A collision merely skips one version write (the daily
  file still has the latest state), so a cheap hash is safe here.
- **Retention spec**: `selectPrunable(names, keep=30)` (daily) and
  `selectPrunableVersions(names, keep=200)` (versions) in backup.ts mirror the Rust
  logic and serve as its executable spec — strict name match per tier, lexicographic
  sort (name = date[-time], both fixed-width so lexicographic == chronological),
  delete beyond `keep`.

## Security model (why Rust commands, not the fs plugin)
The Tauri fs plugin scopes paths statically; a dialog-picked folder is only granted
at runtime and the grant is lost on restart (fixable only via the persisted-scope
plugin + broad fs permissions). Instead the shell exposes exactly two commands
(`app/src-tauri/src/lib.rs`), each taking an **optional `subdir`**:
- `write_backup(dir, file_name, contents, subdir?)` — rejects any `file_name` not
  matching `plan-up-YYYY-MM-DD.json` (23 chars) **or** `plan-up-YYYY-MM-DD-HHMMSS.json`
  (30 chars); no separators possible in either → no path traversal. `subdir` is
  accepted **only** as the empty string (main folder) or the literal `"versions"`
  (hard-coded allow-list in Rust — the frontend can never name an arbitrary subdir);
  `versions/` is `create_dir_all`'d before the write.
- `prune_backups(dir, keep, subdir?)` — same filename + subdir guard; deletes only
  matching files, oldest first, beyond `keep`. A not-yet-created `versions/` prunes
  to a no-op.
Capabilities grant only `core:default` + `dialog:allow-open`; the frontend can never
write/delete anything except backup-named files in the picked folder or its
`versions/` subfolder.

## Rules & edge cases
- Not rendered / no-ops entirely in the web build (`IS_TAURI` guard).
- Toggling off mid-debounce cancels the pending run (enabled re-checked inside run).
- **Daily tier**: same-day overwrite → at most one daily file/day; ≈ 30 days of
  history. **Versions tier**: append-only, never overwritten; each distinct payload
  adds one file, keep newest 200. With the 30 s debounce + dedup that spans roughly
  1–2 weeks of fine-grained rollback points during active use.
- **Dedup**: hashing strips `exportedAt` (it changes every `exportAll()` call);
  a payload that is otherwise identical to the last snapshot writes no new version.
- If two version writes land in the **same second** (rapid `Back up now`), the later
  overwrites the former (same `HHMMSS` name) — acceptable, they carry the same data.
- Backup folder path is a plain string in localStorage — if the folder vanishes, the
  next run fails soft (red status), the app keeps working.

## Future / open questions
- Optional backup-on-quit; configurable retention/quiet window if ever needed.
- **In-app restore picker**: list `versions/` in the modal (date + size) and restore
  a chosen snapshot without hunting in the file manager. For now, restore is manual
  Import of any `versions/*.json`.
