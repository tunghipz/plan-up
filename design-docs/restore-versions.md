# Restore from version (in-app)

**Status:** Implemented
**Last updated:** 2026-07-15
**Code:** `app/src-tauri/src/lib.rs`, `app/src/backup.ts`, `app/src/backup-tauri.ts`, `app/src/BackupSettingsModal.tsx`

## Purpose

Today the only way to restore old data is to manually locate a JSON backup file and
Import it. Desktop auto-backup already writes immutable timestamped snapshots to
`<backupDir>/versions/plan-up-YYYY-MM-DD-HHMMSS.json` (keep 200) — but nothing reads
them back. This feature surfaces that existing history as an **in-app version picker**:
pick a past version, preview it, restore the whole DB to it — without leaving the app.

Related: [auto-backup.md](./auto-backup.md) (writes the snapshots), [persistence-and-backup.md](./persistence-and-backup.md) (`importAll` restore engine), [desktop-app-tauri.md](./desktop-app-tauri.md) (Tauri shell).

## Scope

- **Desktop only (Tauri).** The web build hides the feature entirely (same gate as
  auto-backup — `IS_TAURI`). Web has no snapshot history to read.
- **Source = `<backupDir>/versions/` only.** The immutable `-HHMMSS` snapshots are the
  real history. The daily rolling root files (`plan-up-YYYY-MM-DD.json`, keep 30) are
  **excluded** from the picker — they get overwritten in place, so they aren't distinct
  versions.
- **Granularity = full-DB replace.** Restoring swaps the entire database for the chosen
  snapshot via the existing `importAll()`. No per-project / per-record restore in v1.

## User-facing behavior

1. Desktop → open **Backup settings** modal. A new section **"Restore từ version"** sits
   below the existing backup controls. Shown only when a backup folder is set.
2. Section lists past versions, newest first, each as a human timestamp
   (e.g. `15 Jul 2026, 14:03:07`) parsed from the filename. No file contents read yet —
   the list stays fast even at 200 entries.
3. Click a version → the app reads **that one file** and expands an inline preview:
   the filename plus counts of projects / sprints / tasks.
4. Click **Restore bản này** → confirm dialog titled `Thay toàn bộ dữ liệu?` (its message
   notes the current state is auto-snapshotted first).
5. On confirm: the app reads the target, **auto-snapshots current state** (safety net),
   replaces the DB, then **reloads** the app (no toast — the reload is the confirmation).
   If anything fails before the replace, current data is untouched and an inline error shows.

## Data

No schema change. Reads existing on-disk snapshots (`ExportPayload`, currently v6 —
see [data-model.md](./data-model.md) and `io.ts`). Restore path is the existing
`importAll()` destructive replace over all 8 tables (validate-before-clear, rollback on
error). No new IndexedDB table, no new localStorage key.

## Implementation

### Rust — `app/src-tauri/src/lib.rs` (2 new commands)

Mirror the existing `write_backup` / `prune_backups`: reuse `is_backup_filename` and the
`resolve_dir` allow-list (`""` | `"versions"`), direct `std::fs`, **no new capability**.

- `list_backups(dir, subdir?) -> Vec<String>` — return filenames in the scoped dir that
  match the backup-name regex (path-traversal-safe by construction; names have no
  separators). Register alongside the others at the `invoke_handler` list.
- `read_backup(dir, file_name, subdir?) -> String` — validate `file_name` via
  `is_backup_filename` and `subdir` via `resolve_dir`, then return the file's UTF-8
  contents. Rejects any name/dir outside the allow-list.

### TS pure — `app/src/backup.ts`

- `parseVersionFilename(name) -> Date | null` — inverse of `versionFilename(d)`
  (`plan-up-YYYY-MM-DD-HHMMSS.json` → local `Date`), reusing the existing `VERSION_RE`.
  Pure + unit-testable.

### TS glue — `app/src/backup-tauri.ts` (dynamic `@tauri-apps/*` imports)

- `listVersions() -> {file: string; at: Date}[]` — `invoke('list_backups', {subdir:'versions'})`,
  map through `parseVersionFilename`, drop unparseable, sort by `at` **descending**.
- `readVersion(file) -> ExportPayload` — `invoke('read_backup', {file, subdir:'versions'})`
  then `JSON.parse`.
- `restoreVersion(file) -> void` — orchestrates the flow below.

### Restore flow (`restoreVersion`)

Ordered, fail-safe — current data is only touched at the last, transactional step:

1. **Read + parse** the chosen snapshot (`readVersion`) — non-destructive, so a bad or
   missing file aborts before anything else. Reading first also means the safety snapshot's
   prune (keep newest `VERSIONS_KEEP`) can't evict the very file being restored when
   `versions/` is already at the cap.
2. **Safety snapshot.** `await runBackupNow()`. If it fails (not `ok`), **abort** and
   surface the error — never destroy without a fresh safety net on disk.
3. **`importAll(payload)`** — existing engine: validates shape *before* clearing, then
   clears + `bulkAdd`s all 8 tables in one rw transaction, rolling back on any error.
4. **Reload** the app (`location.reload()`) so all in-memory UI state and the
   selected-project/sprint pointers reset to the restored data.

### UI — `app/src/BackupSettingsModal.tsx`

New **"Restore từ version"** section under the existing auto-backup controls, separated by
the same `border-t border-border-hair` idiom. Layout = **Variant A · inline expand**
(single column, fits the current `max-w-md` sheet — no widening):

- A scrollable list (`max-h-[220px]`) of version rows, newest first, **grouped by day**
  with a small uppercase day label (`Hôm nay` / `14 Jul 2026` / …).
- Each row: a leading dot + the local time (`15 Jul 2026, 14:03:07`, `tabular-nums`).
  Rows come from the filename only — no file read until one is clicked.
- Clicking a row selects it (`bg-accent-tint`) and **expands a preview card inline below
  the row**: the snapshot filename + counts of projects / sprints / tasks (each count
  optional-chained, so a malformed payload can't white-screen the app), and a Fire-accent
  **Restore bản này** button.
- States: loading (`Đang tải…`) · empty (`Chưa có version nào.`) · reading a preview
  (`Đang đọc…`) · restoring (spinner, Restore button disabled) · inline error
  (`text-overdue`). Section shown only when a backup dir is set (§Scope).
- The section is keyed on the backup dir (`<RestoreSection key={dir} />`), so switching
  folders mid-modal remounts it and re-lists against the new folder.

Layout was chosen from a demo (`demo/restore-versions-layout.html`, Variant A) over a
two-pane picker — inline expand keeps the narrow-modal idiom without widening the sheet.

## Rules & edge cases

- **No backup dir set** → section hidden (nothing to list).
- **Empty `versions/`** → "Chưa có version nào." (auto-backup writes the first one only
  after a real data change post-launch).
- **Safety-snapshot failure aborts the restore** — deliberate: we never run the
  destructive replace unless a current-state snapshot just landed on disk.
- **Read / parse failure** → inline error, DB untouched (we fail before `importAll`).
- **Restoring the oldest snapshot at the 200-file cap** — reading before the safety
  snapshot (flow step 1) means the snapshot's prune can't evict the target first.
- **Old payload versions** — `importAll` already accepts v1–v6 with backfills, so older
  snapshots restore fine.
- **`shares` table** — serialized by `exportAll` (v6) and restored by `importAll`, so
  hosted-link write-tokens survive a restore even though the auto-backup *watcher* doesn't
  observe the `shares` table for change-triggering.
- **Undo a bad restore** — the pre-restore state is written into `versions/` (flow step 2)
  before the replace, so the user can immediately restore that new top-of-list entry to
  get back.

## Testing

- `backup.test.ts` — `parseVersionFilename` round-trips `versionFilename(d)`; rejects
  daily-format and malformed names; `listVersions` sort order is newest-first.
- `lib.rs` Rust unit tests — `list_backups` filters to valid names only; `read_backup`
  rejects traversal / disallowed subdir / bad name (mirror existing `is_backup_filename`
  tests).
- Restore correctness is already covered by `backup-roundtrip.test.ts` (`exportAll` →
  `importAll` round-trip); no new DB-replace test needed.

## Future / open questions

- Per-project restore from a full-DB snapshot (extract + remap) — out of scope for v1.
- Listing the daily root files too (currently excluded).
- Web support would require a different history source (e.g. an in-app snapshot table).
