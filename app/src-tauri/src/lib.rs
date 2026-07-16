use std::fs;
use std::path::{Path, PathBuf};

/// Only files the frontend itself names may ever be written or deleted — no
/// separators possible in either shape, so the picked dir can't be escaped:
///   `plan-up-YYYY-MM-DD.json`         (23 chars) — daily rolling file
///   `plan-up-YYYY-MM-DD-HHMMSS.json`  (30 chars) — immutable `versions/` snapshot
fn is_backup_filename(name: &str) -> bool {
    if !name.starts_with("plan-up-") || !name.ends_with(".json") {
        return false;
    }
    let bytes = name.as_bytes();
    // bytes[8..18] = "YYYY-MM-DD" in both shapes
    let date_ok = |b: &[u8]| {
        b.len() == 10
            && b.iter().enumerate().all(|(i, c)| match i {
                4 | 7 => *c == b'-',
                _ => c.is_ascii_digit(),
            })
    };
    match bytes.len() {
        23 => date_ok(&bytes[8..18]),
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

#[tauri::command]
fn write_backup(
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
    fs::write(target.join(&file_name), contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn prune_backups(dir: String, keep: usize, subdir: Option<String>) -> Result<Vec<String>, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            write_backup,
            prune_backups,
            list_backups,
            read_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{is_backup_filename, list_backups, prune_backups, read_backup, write_backup};
    use std::fs;

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
        // versioned (with -HHMMSS)
        assert!(is_backup_filename("plan-up-2026-07-07-153045.json"));
        assert!(is_backup_filename("plan-up-1999-12-31-000000.json"));
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
