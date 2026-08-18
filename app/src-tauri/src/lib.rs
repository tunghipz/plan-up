use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

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
