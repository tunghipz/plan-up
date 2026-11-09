use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// A `.gz` name means the bytes on disk are gzipped — `write_backup` compresses
/// and `read_backup` inflates, so the extension alone describes the encoding and
/// a folder holding both generations needs no migration. Only the `versions/`
/// tier uses it; the daily file stays plain so it can be opened by hand.
fn is_gzipped(name: &str) -> bool {
    name.ends_with(".json.gz")
}

/// Only files the frontend itself names may ever be written or deleted — no
/// separators possible in any shape, so the picked dir can't be escaped:
///   `plan-up-YYYY-MM-DD.json`            (23 chars) — daily rolling file
///   `plan-up-YYYY-MM-DD-HHMMSS.json`     (30 chars) — pre-gzip `versions/` snapshot
///   `plan-up-YYYY-MM-DD-HHMMSS.json.gz`  (33 chars) — `versions/` snapshot
fn is_backup_filename(name: &str) -> bool {
    // Strip the optional `.gz` first, then the shape check is the same as before.
    let stem = name.strip_suffix(".gz").unwrap_or(name);
    if !stem.starts_with("plan-up-") || !stem.ends_with(".json") {
        return false;
    }
    let bytes = stem.as_bytes();
    // bytes[8..18] = "YYYY-MM-DD" in both shapes
    let date_ok = |b: &[u8]| {
        b.len() == 10
            && b.iter().enumerate().all(|(i, c)| match i {
                4 | 7 => *c == b'-',
                _ => c.is_ascii_digit(),
            })
    };
    match bytes.len() {
        // The daily file is never gzipped — `plan-up-YYYY-MM-DD.json.gz` is not a
        // name we write, so don't accept it either.
        23 => !is_gzipped(name) && date_ok(&bytes[8..18]),
        // "-HHMMSS": a dash then 6 digits between the date and ".json"
        30 => {
            date_ok(&bytes[8..18])
                && bytes[18] == b'-'
                && bytes[19..25].iter().all(u8::is_ascii_digit)
        }
        _ => false,
    }
}

/// Resolve the write/prune target: the picked folder, or its `versions/`
/// subfolder. `subdir` is a hard-coded allow-list — the frontend can never name
/// an arbitrary subdirectory, so path traversal via `subdir` is impossible too.
fn resolve_dir(dir: &str, subdir: Option<&str>) -> Result<PathBuf, String> {
    let base = Path::new(dir);
    if !base.is_dir() {
        return Err(format!("backup folder not found: {}", base.display()));
    }
    match subdir {
        None | Some("") => Ok(base.to_path_buf()),
        Some("versions") => Ok(base.join("versions")),
        Some(other) => Err(format!("backup subdir not allowed: {other}")),
    }
}

// ── The backup folder lives on the Rust side ──────────────────────────────
// The file commands used to take `dir` from the webview, so any script running
// in it could write, list, read or prune plan-up backup files in ANY folder.
// Now the folder is chosen in a native panel opened from Rust
// (`pick_backup_dir`), persisted next to the app config, and the file commands
// only ever touch that folder (+ `versions/`). See design-docs/auto-backup.md.

/// The folder the user picked in the native panel; `None` until one is chosen.
struct BackupDir(Mutex<Option<PathBuf>>);

const BACKUP_DIR_FILE: &str = "backup-dir.txt";

fn backup_dir_store(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(BACKUP_DIR_FILE))
}

fn load_backup_dir(app: &AppHandle) -> Option<PathBuf> {
    let raw = fs::read_to_string(backup_dir_store(app).ok()?).ok()?;
    let p = PathBuf::from(raw.trim());
    (!p.as_os_str().is_empty()).then_some(p)
}

fn save_backup_dir(app: &AppHandle, state: &BackupDir, dir: PathBuf) -> Result<(), String> {
    let store = backup_dir_store(app)?;
    if let Some(parent) = store.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&store, dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(dir);
    Ok(())
}

fn chosen_dir(state: &BackupDir) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    guard
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "No backup folder chosen.".to_string())
}

/// Native folder panel, opened from Rust; the pick becomes THE backup folder.
/// Returns the path for display, or None when the user cancels.
#[tauri::command]
async fn pick_backup_dir(app: AppHandle, state: State<'_, BackupDir>) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Choose backup folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    save_backup_dir(&app, &state, dir.clone())?;
    Ok(Some(dir.to_string_lossy().into_owned()))
}

/// One-time migration for a folder picked before the folder moved to Rust (it
/// lives only in the webview's localStorage). Accepted ONLY while Rust has no
/// folder yet; once one is stored this returns the stored path and ignores the
/// argument, so the webview can't redirect backups afterwards.
#[tauri::command]
fn adopt_backup_dir(app: AppHandle, state: State<'_, BackupDir>, dir: String) -> Result<String, String> {
    let existing = state.0.lock().map_err(|e| e.to_string())?.clone();
    if let Some(cur) = existing {
        return Ok(cur.to_string_lossy().into_owned());
    }
    let p = PathBuf::from(&dir);
    if !p.is_dir() {
        return Err(format!("backup folder not found: {dir}"));
    }
    save_backup_dir(&app, &state, p)?;
    Ok(dir)
}

#[tauri::command]
fn write_backup(
    state: State<'_, BackupDir>,
    file_name: String,
    contents: String,
    subdir: Option<String>,
) -> Result<(), String> {
    write_backup_at(chosen_dir(&state)?, file_name, contents, subdir)
}

#[tauri::command]
fn prune_backups(state: State<'_, BackupDir>, keep: usize, subdir: Option<String>) -> Result<Vec<String>, String> {
    prune_backups_at(chosen_dir(&state)?, keep, subdir)
}

#[tauri::command]
fn list_backups(state: State<'_, BackupDir>, subdir: Option<String>) -> Result<Vec<String>, String> {
    list_backups_at(chosen_dir(&state)?, subdir)
}

#[tauri::command]
fn read_backup(state: State<'_, BackupDir>, file_name: String, subdir: Option<String>) -> Result<String, String> {
    read_backup_at(chosen_dir(&state)?, file_name, subdir)
}

fn write_backup_at(
    dir: String,
    file_name: String,
    contents: String,
    subdir: Option<String>,
) -> Result<(), String> {
    if !is_backup_filename(&file_name) {
        return Err(format!("invalid backup filename: {file_name}"));
    }
    let target = resolve_dir(&dir, subdir.as_deref())?;
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let path = target.join(&file_name);
    if !is_gzipped(&file_name) {
        return fs::write(path, contents).map_err(|e| e.to_string());
    }
    // The frontend always hands us plain JSON; compression is ours to do.
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    let bytes = enc.finish().map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

fn prune_backups_at(dir: String, keep: usize, subdir: Option<String>) -> Result<Vec<String>, String> {
    let target = resolve_dir(&dir, subdir.as_deref())?;
    if !target.is_dir() {
        // e.g. versions/ not created yet — nothing to prune.
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
    let mut deleted = Vec::new();
    for name in names.into_iter().skip(keep) {
        fs::remove_file(target.join(&name)).map_err(|e| e.to_string())?;
        deleted.push(name);
    }
    Ok(deleted)
}

fn list_backups_at(dir: String, subdir: Option<String>) -> Result<Vec<String>, String> {
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

fn read_backup_at(dir: String, file_name: String, subdir: Option<String>) -> Result<String, String> {
    if !is_backup_filename(&file_name) {
        return Err(format!("invalid backup filename: {file_name}"));
    }
    let target = resolve_dir(&dir, subdir.as_deref())?;
    let path = target.join(&file_name);
    if !is_gzipped(&file_name) {
        return fs::read_to_string(path).map_err(|e| e.to_string());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut out = String::new();
    GzDecoder::new(&bytes[..])
        .read_to_string(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// Largest file File ▸ Import… will read — far above any real export, low enough
/// that a mis-pick can't balloon the webview.
const IMPORT_MAX_BYTES: u64 = 200 * 1024 * 1024;

/// Menu File ▸ Import… (desktop-native-feel.md): open the native panel FROM
/// RUST and read the file the user picked. A menu action reaches the page over
/// IPC with no user gesture, and WebKit only opens `<input type=file>` inside
/// one, so the page can't pick by itself. The page never hands Rust a path:
/// a command that read any path it was given would let a script in the webview
/// read any `.json` on the machine. Returns None when the user cancels.
#[tauri::command]
async fn pick_import_file(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("plan-up backup", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    read_import_file_at(path.to_string_lossy().into_owned()).map(Some)
}

/// Regular `.json` files only, size-capped.
fn read_import_file_at(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let is_json = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        return Err("only .json files can be imported".into());
    }
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("not a file: {}", p.display()));
    }
    if meta.len() > IMPORT_MAX_BYTES {
        return Err("file is too large to import".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_window_state::StateFlags;

    let app = tauri::Builder::default()
        // Remember size/position across launches (desktop-native-feel.md §3).
        // DECORATIONS is left out — restoring it could undo the overlay title bar —
        // and so is VISIBLE: ⌘W only hides the window, which must not be "restored".
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = load_backup_dir(app.handle());
            app.manage(BackupDir(Mutex::new(dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_backup_dir,
            adopt_backup_dir,
            write_backup,
            prune_backups,
            list_backups,
            read_backup,
            pick_import_file
        ])
        // macOS single-window idiom (Notes, Reminders): closing the window only
        // hides it — the app and auto backup keep running; ⌘Q quits.
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // Dock icon click with the window hidden → bring it back.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } = _event
        {
            use tauri::Manager;
            if let Some(w) = _app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        is_backup_filename, list_backups_at as list_backups, prune_backups_at as prune_backups,
        read_backup_at as read_backup, read_import_file_at as read_import_file,
        write_backup_at as write_backup,
    };
    use std::fs;

    #[test]
    fn read_import_file_reads_json_only() {
        let dir = temp_dir("import");
        let ok = dir.join("export.JSON");
        fs::write(&ok, "{\"v\":1}").unwrap();
        fs::write(dir.join("notes.txt"), "secret").unwrap();
        let s = |p: std::path::PathBuf| p.to_string_lossy().to_string();
        assert_eq!(read_import_file(s(ok)).unwrap(), "{\"v\":1}");
        // wrong extension, missing file, a directory named *.json
        assert!(read_import_file(s(dir.join("notes.txt"))).is_err());
        assert!(read_import_file(s(dir.join("missing.json"))).is_err());
        fs::create_dir_all(dir.join("folder.json")).unwrap();
        assert!(read_import_file(s(dir.join("folder.json"))).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("plan-up-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_valid_names() {
        // daily
        assert!(is_backup_filename("plan-up-2026-07-07.json"));
        assert!(is_backup_filename("plan-up-1999-12-31.json"));
        // versioned (with -HHMMSS) — pre-gzip snapshots stay valid
        assert!(is_backup_filename("plan-up-2026-07-07-153045.json"));
        assert!(is_backup_filename("plan-up-1999-12-31-000000.json"));
        // versioned, gzipped — what we write today
        assert!(is_backup_filename("plan-up-2026-07-07-153045.json.gz"));
        assert!(is_backup_filename("plan-up-1999-12-31-000000.json.gz"));
    }

    #[test]
    fn rejects_everything_else() {
        assert!(!is_backup_filename("plan-up-2026-7-7.json"));
        assert!(!is_backup_filename("plan-up-20260707x.json"));
        assert!(!is_backup_filename("../plan-up-2026-07-07.json"));
        assert!(!is_backup_filename("plan-up-2026-07-07.json.bak"));
        assert!(!is_backup_filename("other-2026-07-07.json"));
        assert!(!is_backup_filename(""));
        // version-shaped but malformed time
        assert!(!is_backup_filename("plan-up-2026-07-07-15304.json")); // 5 time digits
        assert!(!is_backup_filename("plan-up-2026-07-07_153045.json")); // wrong separator
        assert!(!is_backup_filename("plan-up-2026-07-07-15304x.json")); // non-digit
        // the daily file is never gzipped, so don't accept that name either
        assert!(!is_backup_filename("plan-up-2026-07-07.json.gz"));
        // `.gz` doesn't excuse a malformed stem
        assert!(!is_backup_filename("plan-up-2026-7-7.json.gz"));
        assert!(!is_backup_filename("plan-up-2026-07-07-153045.json.gz.gz"));
        assert!(!is_backup_filename("plan-up-2026-07-07-153045.gz"));
    }

    /// Round-trip through the gzip path: on-disk bytes are real gzip (not the
    /// JSON), `read_backup` inflates them back, and a big repetitive payload
    /// actually shrinks — the whole point of the tier.
    #[test]
    fn gzip_version_round_trips() {
        let dir = temp_dir("gzip");
        let d = dir.to_string_lossy().to_string();
        let name = "plan-up-2026-07-07-153045.json.gz";
        let payload = format!("[{}]", vec!["{\"taskId\":\"abc\"}"; 500].join(","));
        write_backup(
            d.clone(),
            name.into(),
            payload.clone(),
            Some("versions".into()),
        )
        .unwrap();

        let raw = fs::read(dir.join("versions").join(name)).unwrap();
        assert_eq!(&raw[..2], &[0x1f, 0x8b], "gzip magic bytes on disk");
        assert!(
            raw.len() < payload.len() / 4,
            "expected real compression, got {} from {}",
            raw.len(),
            payload.len()
        );

        let back = read_backup(d, name.into(), Some("versions".into())).unwrap();
        assert_eq!(back, payload);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// A folder holding both generations: each file reads back correctly by its
    /// own extension, and prune orders them by timestamp, not by extension.
    #[test]
    fn mixed_plain_and_gzip_versions() {
        let dir = temp_dir("mixed");
        let d = dir.to_string_lossy().to_string();
        let plain = "plan-up-2026-07-07-100000.json";
        let gz = "plan-up-2026-07-07-100001.json.gz";
        write_backup(d.clone(), plain.into(), "{\"old\":1}".into(), Some("versions".into()))
            .unwrap();
        write_backup(d.clone(), gz.into(), "{\"new\":1}".into(), Some("versions".into())).unwrap();

        assert_eq!(
            read_backup(d.clone(), plain.into(), Some("versions".into())).unwrap(),
            "{\"old\":1}"
        );
        assert_eq!(
            read_backup(d.clone(), gz.into(), Some("versions".into())).unwrap(),
            "{\"new\":1}"
        );
        // newest-first regardless of extension
        assert_eq!(
            list_backups(d.clone(), Some("versions".into())).unwrap(),
            vec![gz.to_string(), plain.to_string()]
        );
        // keep 1 → the older PLAIN one goes, the newer .gz survives
        assert_eq!(
            prune_backups(d, 1, Some("versions".into())).unwrap(),
            vec![plain.to_string()]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_backup_writes_and_overwrites() {
        let dir = temp_dir("write");
        let d = dir.to_string_lossy().to_string();
        write_backup(d.clone(), "plan-up-2026-07-07.json".into(), "{\"v\":1}".into(), None).unwrap();
        write_backup(d.clone(), "plan-up-2026-07-07.json".into(), "{\"v\":2}".into(), None).unwrap();
        let body = fs::read_to_string(dir.join("plan-up-2026-07-07.json")).unwrap();
        assert_eq!(body, "{\"v\":2}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_version_creates_subfolder() {
        let dir = temp_dir("write-ver");
        let d = dir.to_string_lossy().to_string();
        write_backup(
            d.clone(),
            "plan-up-2026-07-07-153045.json".into(),
            "{\"v\":1}".into(),
            Some("versions".into()),
        )
        .unwrap();
        let body =
            fs::read_to_string(dir.join("versions").join("plan-up-2026-07-07-153045.json")).unwrap();
        assert_eq!(body, "{\"v\":1}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_backup_rejects_bad_names_dir_and_subdir() {
        let dir = temp_dir("reject");
        let d = dir.to_string_lossy().to_string();
        assert!(write_backup(d.clone(), "../evil.json".into(), "x".into(), None).is_err());
        assert!(write_backup(
            "/nonexistent-dir-xyz".into(),
            "plan-up-2026-07-07.json".into(),
            "x".into(),
            None
        )
        .is_err());
        // arbitrary subdir is rejected — only "versions" is allowed
        assert!(write_backup(
            d,
            "plan-up-2026-07-07.json".into(),
            "x".into(),
            Some("../escape".into())
        )
        .is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_keeps_newest_and_ignores_foreign_files() {
        let dir = temp_dir("prune");
        for day in 1..=5 {
            fs::write(dir.join(format!("plan-up-2026-01-{day:02}.json")), "{}").unwrap();
        }
        fs::write(dir.join("notes.txt"), "keep me").unwrap();
        let d = dir.to_string_lossy().to_string();
        let deleted = prune_backups(d, 3, None).unwrap();
        assert_eq!(deleted, vec!["plan-up-2026-01-02.json", "plan-up-2026-01-01.json"]);
        assert!(dir.join("plan-up-2026-01-05.json").exists());
        assert!(dir.join("plan-up-2026-01-03.json").exists());
        assert!(dir.join("notes.txt").exists());
        assert!(!dir.join("plan-up-2026-01-01.json").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_versions_subfolder() {
        let dir = temp_dir("prune-ver");
        let versions = dir.join("versions");
        fs::create_dir_all(&versions).unwrap();
        for min in 1..=4 {
            fs::write(
                versions.join(format!("plan-up-2026-01-01-1000{min:02}.json")),
                "{}",
            )
            .unwrap();
        }
        let d = dir.to_string_lossy().to_string();
        let deleted = prune_backups(d, 2, Some("versions".into())).unwrap();
        assert_eq!(
            deleted,
            vec!["plan-up-2026-01-01-100002.json", "plan-up-2026-01-01-100001.json"]
        );
        assert!(versions.join("plan-up-2026-01-01-100004.json").exists());
        assert!(!versions.join("plan-up-2026-01-01-100001.json").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_missing_versions_is_noop() {
        let dir = temp_dir("prune-missing");
        let d = dir.to_string_lossy().to_string();
        // versions/ never created → no error, nothing deleted
        let deleted = prune_backups(d, 5, Some("versions".into())).unwrap();
        assert!(deleted.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

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
}
