use std::fs;
use std::path::Path;

/// Only files the frontend itself named `plan-up-YYYY-MM-DD.json` may ever be
/// written or deleted — no separators possible, so the picked dir can't be escaped.
fn is_backup_filename(name: &str) -> bool {
    let bytes = name.as_bytes();
    // plan-up-2026-07-07.json → 8 + 10 + 5 = 23 chars
    if bytes.len() != 23 || !name.starts_with("plan-up-") || !name.ends_with(".json") {
        return false;
    }
    let date = &bytes[8..18];
    date.iter().enumerate().all(|(i, b)| match i {
        4 | 7 => *b == b'-',
        _ => b.is_ascii_digit(),
    })
}

#[tauri::command]
fn write_backup(dir: String, file_name: String, contents: String) -> Result<(), String> {
    if !is_backup_filename(&file_name) {
        return Err(format!("invalid backup filename: {file_name}"));
    }
    let dir = Path::new(&dir);
    if !dir.is_dir() {
        return Err(format!("backup folder not found: {}", dir.display()));
    }
    fs::write(dir.join(&file_name), contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn prune_backups(dir: String, keep: usize) -> Result<Vec<String>, String> {
    let dir = Path::new(&dir);
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_backup_filename(n))
        .collect();
    // name == date → lexicographic desc is newest-first
    names.sort_by(|a, b| b.cmp(a));
    let mut deleted = Vec::new();
    for name in names.into_iter().skip(keep) {
        fs::remove_file(dir.join(&name)).map_err(|e| e.to_string())?;
        deleted.push(name);
    }
    Ok(deleted)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![write_backup, prune_backups])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{is_backup_filename, prune_backups, write_backup};
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("plan-up-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_valid_names() {
        assert!(is_backup_filename("plan-up-2026-07-07.json"));
        assert!(is_backup_filename("plan-up-1999-12-31.json"));
    }

    #[test]
    fn rejects_everything_else() {
        assert!(!is_backup_filename("plan-up-2026-7-7.json"));
        assert!(!is_backup_filename("plan-up-20260707x.json"));
        assert!(!is_backup_filename("../plan-up-2026-07-07.json"));
        assert!(!is_backup_filename("plan-up-2026-07-07.json.bak"));
        assert!(!is_backup_filename("other-2026-07-07.json"));
        assert!(!is_backup_filename(""));
    }

    #[test]
    fn write_backup_writes_and_overwrites() {
        let dir = temp_dir("write");
        let d = dir.to_string_lossy().to_string();
        write_backup(d.clone(), "plan-up-2026-07-07.json".into(), "{\"v\":1}".into()).unwrap();
        write_backup(d.clone(), "plan-up-2026-07-07.json".into(), "{\"v\":2}".into()).unwrap();
        let body = fs::read_to_string(dir.join("plan-up-2026-07-07.json")).unwrap();
        assert_eq!(body, "{\"v\":2}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_backup_rejects_bad_names_and_missing_dir() {
        let dir = temp_dir("reject");
        let d = dir.to_string_lossy().to_string();
        assert!(write_backup(d, "../evil.json".into(), "x".into()).is_err());
        assert!(
            write_backup("/nonexistent-dir-xyz".into(), "plan-up-2026-07-07.json".into(), "x".into())
                .is_err()
        );
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
        let deleted = prune_backups(d, 3).unwrap();
        assert_eq!(deleted, vec!["plan-up-2026-01-02.json", "plan-up-2026-01-01.json"]);
        assert!(dir.join("plan-up-2026-01-05.json").exists());
        assert!(dir.join("plan-up-2026-01-03.json").exists());
        assert!(dir.join("notes.txt").exists());
        assert!(!dir.join("plan-up-2026-01-01.json").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
