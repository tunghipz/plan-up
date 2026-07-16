# Restore from version (in-app) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop-only "Restore từ version" section to the backup settings modal that lists the auto-backup `versions/` snapshots, previews the selected one, and restores the whole DB to it.

**Architecture:** Two new Rust commands (`list_backups`, `read_backup`) mirror the existing `write_backup`/`prune_backups` (same name/dir validators, `std::fs`, no new capability). A pure filename parser lands in `backup.ts`. Tauri glue in `backup-tauri.ts` lists/reads snapshots and orchestrates a fail-safe restore (safety snapshot first → read → existing `importAll`). The UI is an inline-expand section (Variant A) in `BackupSettingsModal.tsx`.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 + Dexie; Tauri 2 (Rust) desktop shell; Vitest + cargo test.

**Spec:** `design-docs/restore-versions.md`. **Demo (approved layout):** `demo/restore-versions-layout.html` (Variant A).

## Global Constraints

- **Desktop only.** Every new capability is gated on `IS_TAURI` (from `backup.ts`); the web build shows nothing new. The section also requires a backup dir (`getBackupDir()`).
- **Source folder is `versions/` only** — pass `subdir: VERSIONS_DIR` (`'versions'`) to the Rust commands. Daily root files are excluded.
- **Restore is destructive** — reuse the existing `importAll()` (validate-before-clear, rollback on error). Do not write a new replace path.
- **Fail-safe order** — safety snapshot (`runBackupNow`) **first**; if it isn't `ok`, abort before touching the DB.
- **Brand accent is Fire** (locked): use existing Tailwind tokens (`bg-accent`, `accent-tint`, `text-overdue`, etc.) — never hardcode hex.
- **No new Tauri capability** — `list_backups`/`read_backup` use `std::fs` directly, same as `write_backup`.
- **Sanity gate before any commit that touches `app/`** (from `app/`): `npx tsc --noEmit && npm run build && npx vitest run`. Rust changes also: `cd app/src-tauri && cargo test` (needs rustup on PATH — `source "$HOME/.cargo/env"` if `cargo` not found).
- **Do not `git push`** and **do not `npm version`** — those happen only when the user says "push".

---

### Task 1: `parseVersionFilename` — pure filename → Date parser

**Files:**
- Modify: `app/src/backup.ts` (add one exported function near `versionFilename`, ~line 113)
- Test: `app/src/backup.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: the module-private `VERSION_NAME_RE` (already at `backup.ts:116`).
- Produces: `parseVersionFilename(name: string): Date | null` — inverse of `versionFilename(d)`; returns a **local** `Date`, or `null` for daily-shaped or malformed names.

- [ ] **Step 1: Write the failing tests**

Add to `app/src/backup.test.ts`:

```ts
import { parseVersionFilename } from './backup' // extend the existing import list

describe('parseVersionFilename', () => {
  it('round-trips versionFilename (local parts)', () => {
    const d = new Date(2026, 6, 7, 15, 30, 45)
    expect(parseVersionFilename(versionFilename(d))).toEqual(d)
  })

  it('parses zero-padded midnight', () => {
    expect(parseVersionFilename('plan-up-1999-12-31-000000.json')).toEqual(
      new Date(1999, 11, 31, 0, 0, 0),
    )
  })

  it('rejects the daily-file shape (no time)', () => {
    expect(parseVersionFilename('plan-up-2026-07-07.json')).toBeNull()
  })

  it('rejects malformed names', () => {
    expect(parseVersionFilename('plan-up-2026-07-07-1530.json')).toBeNull()
    expect(parseVersionFilename('plan-up-2026-07-07_153045.json')).toBeNull()
    expect(parseVersionFilename('other-2026-07-07-153045.json')).toBeNull()
    expect(parseVersionFilename('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `app/`): `npx vitest run src/backup.test.ts -t parseVersionFilename`
Expected: FAIL — `parseVersionFilename is not a function` / not exported.

- [ ] **Step 3: Implement**

Add to `app/src/backup.ts` immediately after `versionFilename` (after line 113):

```ts
/**
 * Inverse of `versionFilename`: parse `plan-up-YYYY-MM-DD-HHMMSS.json` back to a
 * LOCAL Date (same clock the name was written with). Returns null for the daily
 * shape (no time) or any malformed name — the version picker drops those.
 */
export function parseVersionFilename(name: string): Date | null {
  if (!VERSION_NAME_RE.test(name)) return null
  const y = Number(name.slice(8, 12))
  const mo = Number(name.slice(13, 15))
  const d = Number(name.slice(16, 18))
  const hh = Number(name.slice(19, 21))
  const mm = Number(name.slice(21, 23))
  const ss = Number(name.slice(23, 25))
  return new Date(y, mo - 1, d, hh, mm, ss)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `app/`): `npx vitest run src/backup.test.ts -t parseVersionFilename`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/backup.ts app/src/backup.test.ts
git commit -m "feat(restore): parseVersionFilename — version name to local Date"
```

---

### Task 2: Rust `list_backups` + `read_backup` commands

**Files:**
- Modify: `app/src-tauri/src/lib.rs` (two new `#[tauri::command]` fns after `prune_backups` ~line 85; extend `generate_handler!` at line 94; extend `use super::{…}` in tests at line 101; add tests in the `tests` module)

**Interfaces:**
- Consumes: existing `is_backup_filename` (`lib.rs:8`) and `resolve_dir` (`lib.rs:36`).
- Produces (invoked from TS in Task 3):
  - `list_backups(dir: String, subdir: Option<String>) -> Result<Vec<String>, String>` — filenames in the scoped dir passing `is_backup_filename`, newest-first; `Ok(vec![])` if the dir doesn't exist.
  - `read_backup(dir: String, file_name: String, subdir: Option<String>) -> Result<String, String>` — UTF-8 contents of one validated file.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `app/src-tauri/src/lib.rs` (and add `list_backups, read_backup` to the `use super::{…}` line):

```rust
#[test]
fn list_backups_filters_and_sorts_newest_first() {
    let dir = temp_dir("list");
    let versions = dir.join("versions");
    fs::create_dir_all(&versions).unwrap();
    for (i, name) in ["plan-up-2026-01-01-100001.json", "plan-up-2026-01-01-100003.json", "plan-up-2026-01-01-100002.json"].iter().enumerate() {
        fs::write(versions.join(name), format!("{{\"i\":{i}}}")).unwrap();
    }
    fs::write(versions.join("notes.txt"), "ignore").unwrap();
    let d = dir.to_string_lossy().to_string();
    let names = list_backups(d, Some("versions".into())).unwrap();
    assert_eq!(
        names,
        vec![
            "plan-up-2026-01-01-100003.json",
            "plan-up-2026-01-01-100002.json",
            "plan-up-2026-01-01-100001.json",
        ]
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn list_backups_missing_dir_is_empty() {
    let dir = temp_dir("list-missing");
    let d = dir.to_string_lossy().to_string();
    assert!(list_backups(d, Some("versions".into())).unwrap().is_empty());
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn read_backup_reads_valid_and_rejects_bad() {
    let dir = temp_dir("read");
    let versions = dir.join("versions");
    fs::create_dir_all(&versions).unwrap();
    fs::write(versions.join("plan-up-2026-07-07-153045.json"), "{\"ok\":true}").unwrap();
    let d = dir.to_string_lossy().to_string();
    // valid
    let body = read_backup(d.clone(), "plan-up-2026-07-07-153045.json".into(), Some("versions".into())).unwrap();
    assert_eq!(body, "{\"ok\":true}");
    // bad name
    assert!(read_backup(d.clone(), "../evil.json".into(), Some("versions".into())).is_err());
    // disallowed subdir
    assert!(read_backup(d, "plan-up-2026-07-07-153045.json".into(), Some("../escape".into())).is_err());
    fs::remove_dir_all(&dir).unwrap();
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/src-tauri && cargo test`
Expected: FAIL — `cannot find function list_backups` / `read_backup`.

- [ ] **Step 3: Implement the commands**

Add after `prune_backups` (after `lib.rs:85`):

```rust
#[tauri::command]
fn list_backups(dir: String, subdir: Option<String>) -> Result<Vec<String>, String> {
    let target = resolve_dir(&dir, subdir.as_deref())?;
    if !target.is_dir() {
        // versions/ not created yet — nothing to list.
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&target).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_backup_filename(n))
        .collect();
    // name == date[-time], fixed width → lexicographic desc is newest-first
    names.sort_by(|a, b| b.cmp(a));
    Ok(names)
}

#[tauri::command]
fn read_backup(dir: String, file_name: String, subdir: Option<String>) -> Result<String, String> {
    if !is_backup_filename(&file_name) {
        return Err(format!("invalid backup filename: {file_name}"));
    }
    let target = resolve_dir(&dir, subdir.as_deref())?;
    fs::read_to_string(target.join(&file_name)).map_err(|e| e.to_string())
}
```

Then extend the handler registration at `lib.rs:94`:

```rust
        .invoke_handler(tauri::generate_handler![
            write_backup,
            prune_backups,
            list_backups,
            read_backup
        ])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/src-tauri && cargo test`
Expected: PASS (all existing tests + the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/lib.rs
git commit -m "feat(restore): Tauri list_backups + read_backup commands"
```

---

### Task 3: Tauri glue — `listVersions`, `readVersion`, `restoreVersion`

**Files:**
- Modify: `app/src/backup-tauri.ts` (add imports + one interface + three functions)

**Interfaces:**
- Consumes: `parseVersionFilename` (Task 1), `list_backups`/`read_backup` (Task 2), existing `runBackupNow` (this file), `importAll` from `./io`, `getBackupDir`/`IS_TAURI`/`VERSIONS_DIR` from `./backup`.
- Produces (used by Task 4):
  - `interface VersionEntry { file: string; at: Date }`
  - `listVersions(): Promise<VersionEntry[]>` — newest-first; `[]` off-desktop or no dir.
  - `readVersion(file: string): Promise<ExportPayload>` — parsed snapshot JSON.
  - `restoreVersion(file: string): Promise<void>` — safety-snapshot → read → `importAll`; throws (DB untouched) if the safety snapshot fails or the read fails.

- [ ] **Step 1: Extend imports**

In `app/src/backup-tauri.ts`, add to the existing `./backup` import list `parseVersionFilename`, and add two new imports below the existing ones (top of file):

```ts
import { importAll, type ExportPayload } from './io'
```

And add `parseVersionFilename,` into the `from './backup'` import block (alongside `versionFilename,`).

- [ ] **Step 2: Implement the three functions**

Append to `app/src/backup-tauri.ts`:

```ts
/** A restorable snapshot in `versions/` — the file name and its parsed local time. */
export interface VersionEntry {
  file: string
  at: Date
}

/**
 * List the immutable `versions/` snapshots, newest first. Off-desktop or with no
 * backup folder set there is nothing to list, so returns []. Names that don't
 * parse as version files are dropped (the folder only ever holds our own writes,
 * but be defensive).
 */
export async function listVersions(): Promise<VersionEntry[]> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) return []
  const { invoke } = await import('@tauri-apps/api/core')
  const names = await invoke<string[]>('list_backups', { dir, subdir: VERSIONS_DIR })
  return names
    .map((file) => ({ file, at: parseVersionFilename(file) }))
    .filter((e): e is VersionEntry => e.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Read + parse one `versions/` snapshot. Throws if unreadable or not JSON. */
export async function readVersion(file: string): Promise<ExportPayload> {
  const dir = getBackupDir()
  if (!IS_TAURI || !dir) throw new Error('No backup folder chosen.')
  const { invoke } = await import('@tauri-apps/api/core')
  const contents = await invoke<string>('read_backup', { dir, fileName: file, subdir: VERSIONS_DIR })
  return JSON.parse(contents) as ExportPayload
}

/**
 * Restore the whole DB to a chosen snapshot. Fail-safe order: snapshot the
 * CURRENT state first (so a mistaken restore is itself undoable) and abort if
 * that write fails — never destroy without a fresh net. Then read the target and
 * hand it to importAll (which validates before clearing and rolls back on error).
 * The caller reloads the app on success.
 */
export async function restoreVersion(file: string): Promise<void> {
  const snap = await runBackupNow()
  if (!snap.ok) {
    throw new Error(`Could not back up current data first: ${snap.error ?? 'unknown error'}`)
  }
  const payload = await readVersion(file)
  await importAll(payload)
}
```

- [ ] **Step 3: Typecheck**

Run (from `app/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/backup-tauri.ts
git commit -m "feat(restore): listVersions/readVersion/restoreVersion glue"
```

*(No unit test: this is dynamic-`@tauri-apps` glue, matching the untested existing `runBackupNow`/`startAutoBackup` in the same file. Verified via tsc + the manual desktop check in Task 4.)*

---

### Task 4: UI — "Restore từ version" section (Variant A)

**Files:**
- Modify: `app/src/BackupSettingsModal.tsx` (add imports, a `RestoreSection` component + a `PreviewStat` helper + two date formatters, and mount the section)

**Interfaces:**
- Consumes: `listVersions`/`readVersion`/`restoreVersion`/`VersionEntry` (Task 3), `useConfirm` from `./confirm-context`, `ExportPayload` from `./io`, `VERSIONS_KEEP` (already imported from `./backup`).
- Produces: no exports — internal component wired into the modal body.

- [ ] **Step 1: Add imports**

At the top of `app/src/BackupSettingsModal.tsx`:

```ts
import { useConfirm } from './confirm-context'
import { pickBackupDir, runBackupNow, listVersions, readVersion, restoreVersion, type VersionEntry } from './backup-tauri'
import type { ExportPayload } from './io'
```

(Replace the existing `import { pickBackupDir, runBackupNow } from './backup-tauri'` line with the expanded one above. `VERSIONS_KEEP` is already in the `./backup` import.)

- [ ] **Step 2: Add the date helpers + PreviewStat + RestoreSection**

Add above the `BackupSettingsModal` function (after the existing `timeAgo` helper):

```tsx
function fmtVersionTime(d: Date): string {
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function dayLabel(d: Date): string {
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return 'Hôm nay'
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function PreviewStat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-[19px] font-bold tabular-nums leading-none">{n}</div>
      <div className="text-[11px] text-ink-muted mt-1">{label}</div>
    </div>
  )
}

/**
 * Restore-from-version section (design-docs/restore-versions.md, Variant A).
 * Lists versions/ snapshots (timestamps only — no read), expands a preview
 * inline on select, and restores the whole DB via restoreVersion() then reloads.
 * Rendered only when a backup dir is set (desktop).
 */
function RestoreSection() {
  const confirm = useConfirm()
  const [entries, setEntries] = useState<VersionEntry[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<ExportPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listVersions()
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])

  const pick = async (file: string) => {
    setSelected(file)
    setPreview(null)
    setErr(null)
    setBusy(true)
    try {
      setPreview(await readVersion(file))
    } catch (e) {
      setErr(`Không đọc được version: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (file: string, at: Date) => {
    const ok = await confirm({
      title: 'Thay toàn bộ dữ liệu?',
      message: `Khôi phục về ${fmtVersionTime(at)} sẽ thay toàn bộ dữ liệu hiện tại bằng bản đó. State hiện tại được tự backup vào versions/ trước — restore nhầm vẫn quay lại được.`,
      confirmLabel: 'Restore',
    })
    if (!ok) return
    setBusy(true)
    setErr(null)
    try {
      await restoreVersion(file)
      location.reload()
    } catch (e) {
      setErr(`Restore thất bại: ${String(e)}`)
      setBusy(false)
    }
  }

  return (
    <div className="pt-2 border-t border-border-hair space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] font-medium text-ink">Restore từ version</span>
        <span className="text-[11.5px] text-ink-faint">{VERSIONS_KEEP} bản gần nhất</span>
      </div>

      {entries === null ? (
        <p className="text-[12px] text-ink-faint">Đang tải…</p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-ink-faint leading-snug">
          Chưa có version nào. Bản đầu tiên được ghi sau thay đổi dữ liệu đầu tiên.
        </p>
      ) : (
        <div className="max-h-[220px] overflow-auto -mx-1.5 px-1.5 flex flex-col gap-0.5">
          {entries.map((e, i) => {
            const showDay = i === 0 || dayLabel(entries[i - 1].at) !== dayLabel(e.at)
            const sel = e.file === selected
            return (
              <div key={e.file}>
                {showDay && (
                  <div className="px-2.5 pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {dayLabel(e.at)}
                  </div>
                )}
                <button
                  onClick={() => pick(e.file)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] text-left transition ${
                    sel ? 'bg-accent-tint' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${sel ? 'bg-accent' : 'bg-border-strong'}`}
                  />
                  <span className="flex-1 min-w-0 text-[13px] tabular-nums truncate">
                    {fmtVersionTime(e.at)}
                  </span>
                </button>
                {sel && (
                  <div className="mt-1 mb-1 bg-surface border border-border-hair rounded-[12px] p-3">
                    {busy && !preview ? (
                      <p className="text-[12px] text-ink-faint">Đang đọc…</p>
                    ) : preview ? (
                      <>
                        <div className="mb-2.5 text-[11px] text-ink-faint tabular-nums truncate">
                          {e.file}
                        </div>
                        <div className="flex gap-4">
                          <PreviewStat n={preview.projects?.length ?? 0} label="project" />
                          <PreviewStat n={preview.sprints.length} label="sprint" />
                          <PreviewStat n={preview.tasks.length} label="task" />
                        </div>
                        <div className="flex justify-end pt-3">
                          <button
                            onClick={() => restore(e.file, e.at)}
                            disabled={busy}
                            className="text-xs font-semibold px-3 py-1.5 rounded-[8px] bg-accent text-white hover:bg-accent-hover transition disabled:opacity-40 inline-flex items-center gap-2"
                          >
                            {busy && (
                              <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                            )}
                            Restore bản này
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {err && <p className="text-[12px] text-overdue leading-snug break-words">{err}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Mount the section in the modal**

In `BackupSettingsModal`'s returned JSX, insert `{dir && <RestoreSection />}` **between** the auto-backup status row (the `div` ending at `BackupSettingsModal.tsx:151`) and the final "Done" footer (`div` at line 153):

```tsx
      {dir && <RestoreSection />}

      <div className="flex justify-end pt-1">
        <button
          onClick={onClose}
          ...
```

- [ ] **Step 4: Typecheck + build + tests**

Run (from `app/`): `npx tsc --noEmit && npm run build && npx vitest run`
Expected: all pass, no type errors.

- [ ] **Step 5: Manual desktop check**

Run the desktop shell (`npm run tauri dev` from `app/`, or the packaged app) with a backup folder that has `versions/` snapshots:
- The "Restore từ version" section lists timestamps newest-first, grouped by day.
- Clicking a row expands a preview with project/sprint/task counts.
- "Restore bản này" → confirm dialog → on confirm the app reloads with the restored data; a fresh pre-restore snapshot appears at the top of `versions/`.
- Empty folder shows "Chưa có version nào."; web build shows no section.

*(If a desktop build isn't available in this environment, note that Step 5 is deferred to the user and rely on Steps 1–4 for the gate.)*

- [ ] **Step 6: Commit**

```bash
git add app/src/BackupSettingsModal.tsx
git commit -m "feat(restore): in-app version picker section (Variant A)"
```

---

## Self-Review

**Spec coverage** (against `design-docs/restore-versions.md`):
- Desktop-only + dir-gated → Task 4 Step 3 (`{dir && …}`), Task 3 (`IS_TAURI` guards). ✓
- Source = `versions/` only → `subdir: VERSIONS_DIR` in Task 2/3. ✓
- Full-DB replace via `importAll` → Task 3 `restoreVersion`. ✓
- Safety snapshot first, abort on failure → Task 3 `restoreVersion`. ✓
- List timestamps (no read) + preview on select → Task 4 `RestoreSection`. ✓
- Variant A inline expand, day-grouped → Task 4. ✓
- Empty / confirm / restoring states → Task 4 (empty text, `useConfirm`, spinner). ✓
- Rust `list_backups`/`read_backup`, no new capability → Task 2. ✓
- `parseVersionFilename` unit-tested; Rust unit-tested → Tasks 1, 2. ✓
- Reload after restore → Task 4 `restore` (`location.reload()`). ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `VersionEntry {file, at}`, `listVersions/readVersion/restoreVersion` signatures, `importAll(data: ExportPayload)`, and the Rust `list_backups(dir, subdir)`/`read_backup(dir, file_name, subdir)` params (`fileName` in the JS `invoke` call maps to Rust `file_name`, matching the existing `write_backup` call at `backup-tauri.ts:57`) are consistent across Tasks 1–4. ✓
