# Auto backup (desktop only)

**Status:** Implemented
**Last updated:** 2026-07-07
**Code:** `app/src/backup.ts`, `app/src/backup-tauri.ts`, `app/src/BackupSettingsModal.tsx`, `app/src-tauri/src/lib.rs`, `app/src/App.tsx`

## Purpose
IndexedDB is the only home of the data; a container reset or accidental "Replace all"
loses everything since the last manual export. In the desktop (Tauri) build the app
can write real files, so: pick a folder once, and the app silently keeps a daily
full-backup JSON there whenever data changes. Desktop-only — a browser cannot write
to an arbitrary folder unattended.

> Sibling of the manual **Export all** flow — see
> [persistence-and-backup.md](./persistence-and-backup.md). Same payload
> (`exportAll()`, v5), different trigger and destination. Restoring a backup file
> uses the normal Import button.

## User-facing behavior
- Export menu (header) gains an **"Auto backup…"** item — only in the desktop app.
- Modal (ModalSheet): enable/disable toggle · chosen folder path + "Choose folder…"
  (native directory picker; picking a folder when none was set also enables) ·
  **Back up now** button · last-backup status line (green "Last backup <time> →
  <file>" or red error message) · caption "Keeps the newest 30 daily files".
- With backup enabled + folder chosen: any data change → after **30 s of quiet** the
  app writes `plan-up-YYYY-MM-DD.json` (local date) into the folder, **overwriting
  the same-day file**, then prunes to the **newest 30** `plan-up-*.json` files.
- Failures (folder deleted, unwritable) never interrupt the app — the status line in
  the modal turns red with the OS error; re-pick the folder to fix.

## Data
Reads every table via `exportAll()` (io.ts) — payload identical to manual full export.
Writes nothing to the DB. Settings live in localStorage:
`plan-up:backupDir` (path), `plan-up:backupEnabled` (`'1'`),
`plan-up:backupLast` (JSON `BackupStatus {at, ok, file?, error?}`).

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
  explicit user click) → `exportAll()` → `invoke('write_backup', …)` →
  `invoke('prune_backups', {keep: 30})` → persist `BackupStatus`. All errors are
  caught into `{ok:false, error}` — never thrown.
- **Filename**: `backupFilename(date)` uses **local** date parts (the manual export
  slices UTC `exportedAt` — deliberate difference: "today's file" should follow the
  user's clock).
- **Retention spec**: `selectPrunable(names, keep=30)` in backup.ts mirrors the Rust
  logic and serves as its executable spec — strict `plan-up-YYYY-MM-DD.json` match,
  lexicographic sort (name = date), delete beyond newest 30.

## Security model (why Rust commands, not the fs plugin)
The Tauri fs plugin scopes paths statically; a dialog-picked folder is only granted
at runtime and the grant is lost on restart (fixable only via the persisted-scope
plugin + broad fs permissions). Instead the shell exposes exactly two commands
(`app/src-tauri/src/lib.rs`):
- `write_backup(dir, file_name, contents)` — rejects any `file_name` not matching
  `plan-up-YYYY-MM-DD.json` (no separators possible → no path traversal), then writes.
- `prune_backups(dir, keep)` — deletes only files matching the same pattern, oldest
  first, beyond `keep`.
Capabilities grant only `core:default` + `dialog:allow-open`; the frontend can never
write/delete anything except same-named backup files in the folder the user picked.

## Rules & edge cases
- Not rendered / no-ops entirely in the web build (`IS_TAURI` guard).
- Toggling off mid-debounce cancels the pending run (enabled re-checked inside run).
- Same-day overwrite means at most one file per day; retention ≈ 30 days of history.
- Backup folder path is a plain string in localStorage — if the folder vanishes, the
  next run fails soft (red status), the app keeps working.

## Future / open questions
- Optional backup-on-quit; configurable retention/quiet window if ever needed.
