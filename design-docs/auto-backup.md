# Auto backup (desktop only)

**Status:** Implemented
**Last updated:** 2026-08-18 (**disk-footprint pass** — `versions/` snapshots are now
**gzipped** (`…-HHMMSS.json.gz`, ≈3.5× smaller, compressed in Rust so the tier stays
self-describing and old `.json` snapshots keep working) and the tier's retention drops
**200 → 50**. Together ≈10× less disk. The daily tier is untouched: still plain,
hand-Importable JSON. Requires a new desktop build — the Rust filename guard and
write/read paths changed. See *Disk footprint* below for the measurements that drove it.)
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
(`plan-up-YYYY-MM-DD-HHMMSS.json.gz`, gzipped). The daily file alone meant a bad edit + the
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
  <file>" or red error message) · caption "Keeps 30 daily files + 50 versions/".
- With backup enabled + folder chosen: any data change → after **30 s of quiet** the
  app (1) writes `plan-up-YYYY-MM-DD.json` (local date) into the folder, **overwriting
  the same-day file**, and prunes to the **newest 30** daily files; (2) unless the
  payload is byte-identical to the last snapshot (dedup), also writes an immutable
  **gzipped** `versions/plan-up-YYYY-MM-DD-HHMMSS.json.gz` and prunes `versions/` to the
  **newest 50**.
- Failures (folder deleted, unwritable) never interrupt the app — the status line in
  the modal turns red with the OS error; re-pick the folder to fix.
- **Restore** from `versions/` is the in-app picker
  ([restore-versions.md](./restore-versions.md)) — it reads through Rust, which
  transparently gunzips. Restoring **by hand** uses the normal **Import** button on the
  daily file (still plain JSON). A `versions/*.json.gz` can also be hand-Imported after
  a `gunzip` (double-click in Finder) — one extra step, the price of the 3.5×.

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
     VERSIONS_KEEP=50, subdir: 'versions'})`, then persist the new hash. Identical
     payload → skip the version write (the daily file already reflects it). The
     frontend hands Rust the **plain** JSON string either way — gzip is Rust's job,
     triggered by the `.gz` the filename already carries.
  - Persists `BackupStatus` (with the daily filename). All errors caught into
    `{ok:false, error}` — never thrown. Status stays `ok` even when the version write
    was skipped by dedup.
- **Filenames** (backup.ts): `backupFilename(date)` → `plan-up-YYYY-MM-DD.json`;
  `versionFilename(date)` → `plan-up-YYYY-MM-DD-HHMMSS.json.gz`. Both use **local** date
  parts (the manual export slices UTC `exportedAt` — deliberate difference: "today's
  file" should follow the user's clock). `parseVersionFilename` accepts **both**
  `.json` and `.json.gz` so snapshots written before this change stay listed and
  restorable; the timestamp lives in a fixed-width prefix, so a mixed folder still
  sorts chronologically (the extension only differs past index 25, by which point the
  timestamps already have).
- **Dedup hash**: `hashString(s)` — tiny non-crypto FNV-1a, only needs to detect
  "same payload as last run". A collision merely skips one version write (the daily
  file still has the latest state), so a cheap hash is safe here.
- **Retention spec**: `selectPrunable(names, keep=30)` (daily) and
  `selectPrunableVersions(names, keep=50)` (versions) in backup.ts mirror the Rust
  logic and serve as its executable spec — strict name match per tier, lexicographic
  sort (name = date[-time], both fixed-width so lexicographic == chronological),
  delete beyond `keep`.

## Security model (why Rust commands, not the fs plugin)
The Tauri fs plugin scopes paths statically; a dialog-picked folder is only granted
at runtime and the grant is lost on restart (fixable only via the persisted-scope
plugin + broad fs permissions). Instead the shell exposes exactly two commands
(`app/src-tauri/src/lib.rs`), each taking an **optional `subdir`**:
- `write_backup(dir, file_name, contents, subdir?)` — rejects any `file_name` not
  matching `plan-up-YYYY-MM-DD.json` (23 chars), `plan-up-YYYY-MM-DD-HHMMSS.json`
  (30) or `plan-up-YYYY-MM-DD-HHMMSS.json.gz` (33); no separators possible in any of
  the three → no path traversal. A `.gz` name makes Rust **gzip `contents` before
  writing**; `read_backup` gunzips the same way, so the extension alone describes the
  encoding and a folder holding both generations just works. `subdir` is
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
  adds one file, keep newest 50. Retention here is **write-count-bound, not
  time-bound** — a busy day burns through it much faster than a quiet week (see
  *Disk footprint*), so the daily tier, not this one, is what guarantees reach back
  in time.
- **Dedup**: hashing strips `exportedAt` (it changes every `exportAll()` call);
  a payload that is otherwise identical to the last snapshot writes no new version.
- If two version writes land in the **same second** (rapid `Back up now`), the later
  overwrites the former (same `HHMMSS` name) — acceptable, they carry the same data.
- **Old `.json` snapshots are never migrated.** They stay listed, restorable and
  prunable exactly as before, and simply age out of the newest-50 window. On the first
  run after upgrading, the drop 200 → 50 deletes the overflow in one prune.
- Backup folder path is a plain string in localStorage — if the folder vanishes, the
  next run fails soft (red status), the app keeps working.

## Disk footprint (why gzip + keep 50)

Measured 2026-08-18 on a real folder (`~/Library/Mobile Documents/…/plan-up-backup`,
6 projects / 28 sprints / 228 tasks) after ~5 weeks of use — **211 MB**:

| tier | files | size | span |
| --- | --- | --- | --- |
| `versions/` | 177 | **198 MB** | 15/7 – 14/8 (~1 month, 15 active days) |
| daily | 22 | 22 MB | 7/7 – 18/8 (~1.5 months) |

The versions tier cost **9× the daily tier for the same window** — because its
retention counts *writes*, not *days*: an active day produces ~20 snapshots, a quiet
week produces none.

One snapshot was 1.37 MB, and it is **not** mostly the plan:

| part | size | share |
| --- | --- | --- |
| `events` (3176 rows) | 1081 KB | **79 %** |
| base64 `avatarImage` + project `icon` | 208 KB | 15 % |
| tasks / sprints / projects / members | 82 KB | 6 % |

The activity log **is** capped — `MAX_EVENTS_PER_SPRINT = 500`
([sprint-activity-log.md](./sprint-activity-log.md)) — but **per sprint**, and sprints
never expire. So every new sprint adds up to ~170 KB to *every future snapshot*, i.e.
the per-snapshot size grows without bound as the project ages, and the folder grows as
that size × the retention count.

Two fixes shipped, chosen because both are cheap and multiply:

1. **`VERSIONS_KEEP` 200 → 50** — 198 MB → ~65 MB, one constant, prune does the rest.
2. **gzip `versions/`** — measured 1.37 MB → 390 KB (**3.5×**) on the real payload;
   JSON full of repeated keys and UUIDs compresses very well. Applies to *every* part
   above, including the base64 blobs, so it keeps paying as the payload grows.

Combined ≈ **19 MB** for the tier (from 198 MB). The daily tier is deliberately left
**uncompressed**: it is the "app is gone, open the file by hand" escape hatch, and
30 plain files is a price worth paying for that.

Not done (and why): pulling `events` out of the snapshot would shrink it ~5× more but
makes a restored DB lose its activity history — a data decision, not a disk one.
Content-addressing the avatar/icon blobs into `versions/blobs/<hash>.png` would save
another ~15 % but changes the snapshot format. Time-based (GFS) retention — keep all of
the last 7 days, then 1/day for 30, then 1/week — measured 83 MB uncompressed while
covering the *same* span, and would make the tier bounded regardless of edit
frequency; it is the right answer if the count-based cap ever proves too coarse.

## Future / open questions
- Optional backup-on-quit; configurable retention/quiet window if ever needed.
- **Time-based (GFS) retention** for `versions/` instead of the count cap — see
  *Disk footprint*. Makes the tier bounded in *time*, not in writes.
- **Global event retention** (age or total-count cap across sprints) — the real lever
  on snapshot size, but it trades away history.
- ~~In-app restore picker~~ — shipped, see [restore-versions.md](./restore-versions.md).
