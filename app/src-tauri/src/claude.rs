// Claude assistant (design-docs/claude-assistant.md): runs the locally installed Claude Code
// CLI in headless mode so the panel uses the user's own Claude subscription, and writes the
// slide decks the panel renders. The webview only picks the model and sends the prompt text
// and the answer schema; every CLI flag is fixed here. The run has no tools, no user
// settings, hooks, plugins, skills or MCP servers: project data reaches Claude only through
// the prompt, and changes reach the database only when the user presses Apply in the app.
// Ported from cll-space (telegram-ai/app/tauri/src/claude.rs), where it runs in daily use.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const ALLOWED_MODELS: [&str; 2] = ["sonnet", "opus"];
const WORK_DIR_NAME: &str = "plan-up-claude";
const FALLBACK_DIRS: [&str; 4] = [".local/bin", ".claude/local", "/opt/homebrew/bin", "/usr/local/bin"];
const SHELL_OUTPUT_MARKER: &str = "__plan_up_claude__";
const CONFIG_DIR_VAR: &str = "CLAUDE_CONFIG_DIR";

/// Must match `CLAUDE_NOT_FOUND` in `src/claude-run.ts`.
pub const ERROR_NOT_FOUND: &str = "claude_not_found";

// The CLI prints its `system init` line a few seconds after start. A process silent this long is
// stuck before reading stdin, typically in `open()` on `CLAUDE_CONFIG_DIR` under `~/Documents`
// while macOS holds a privacy prompt for this app. It is killed so the run fails with a hint
// instead of hanging forever (seen in cll-space, see its docs/dong-goi.md).
const FIRST_OUTPUT_TIMEOUT: Duration = Duration::from_secs(45);
const FIRST_OUTPUT_TIMEOUT_MESSAGE: &str = "Claude Code did not respond within 45 seconds. macOS may be \
  waiting for you to answer a permission prompt for plan-up (Documents access). Answer it, then try again.";

/// Largest deck the app will write — far above any real deck (a 20-slide deck is ~60 KB).
const DECK_MAX_BYTES: usize = 5 * 1024 * 1024;
const DECK_DIR_NAME: &str = "decks";

static RUNNING: LazyLock<Mutex<HashMap<String, Child>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
// A cancel can arrive before its process is registered in `RUNNING`; the stream command checks
// this set under the same lock order (`RUNNING`, then `CANCELLED`).
static CANCELLED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
const MAX_CANCELLED: usize = 100;

// Apps started from Finder get neither the shell `PATH` nor variables exported in `.zshrc`, such
// as `CLAUDE_CONFIG_DIR`, which selects the logged-in Claude Code profile. An interactive login
// shell resolves both once, the same way the user's terminal does. It takes a few seconds, so
// `warm_claude_env` resolves it at app start instead of on the first request.
static SHELL_ENV: LazyLock<ShellEnv> = LazyLock::new(read_shell_env);

struct ShellEnv {
    claude_path: Option<PathBuf>,
    config_dir: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClaudeEvent {
    Line { line: String },
    Exit { code: Option<i32>, stderr: String },
}

pub fn warm_claude_env() {
    std::thread::spawn(|| {
        LazyLock::force(&SHELL_ENV);
    });
}

#[tauri::command]
pub async fn claude_stream(
    request_id: String,
    model: String,
    system_prompt: String,
    prompt: String,
    json_schema: String,
    on_event: Channel<ClaudeEvent>,
) -> Result<(), String> {
    if !ALLOWED_MODELS.contains(&model.as_str()) {
        return Err(format!("Unsupported model: {model}"));
    }
    // Resolving the shell environment and spawning the process both block.
    tauri::async_runtime::spawn_blocking(move || {
        start_claude(request_id, model, system_prompt, prompt, json_schema, on_event)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn claude_cancel(request_id: String) {
    let Ok(mut running) = RUNNING.lock() else {
        return;
    };
    if let Some(child) = running.get_mut(&request_id) {
        let _ = child.kill();
    } else if let Ok(mut cancelled) = CANCELLED.lock() {
        if cancelled.len() >= MAX_CANCELLED {
            cancelled.clear();
        }
        cancelled.insert(request_id);
    }
}

fn start_claude(
    request_id: String,
    model: String,
    system_prompt: String,
    prompt: String,
    json_schema: String,
    on_event: Channel<ClaudeEvent>,
) -> Result<(), String> {
    let shell_env = &*SHELL_ENV;
    let claude_path = shell_env.claude_path.clone().ok_or_else(|| ERROR_NOT_FOUND.to_string())?;
    let work_dir = std::env::temp_dir().join(WORK_DIR_NAME);
    fs::create_dir_all(&work_dir).map_err(|err| err.to_string())?;

    let mut command = Command::new(claude_path);
    // A profile inherited from the launching process (started from a terminal) wins over `.zshrc`.
    if std::env::var(CONFIG_DIR_VAR).is_err() {
        if let Some(config_dir) = &shell_env.config_dir {
            command.env(CONFIG_DIR_VAR, config_dir);
        }
    }
    command.args([
        "-p",
        // The prompt is one stream-json user message on stdin.
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        &model,
        "--system-prompt",
        &system_prompt,
        "--tools",
        "",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--json-schema",
        &json_schema,
    ]);

    let mut child = command
        // An API key in the environment would take precedence over the subscription login.
        .env_remove("ANTHROPIC_API_KEY")
        .current_dir(work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;

    let mut stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let mut stderr = child.stderr.take().ok_or("No stderr")?;

    {
        let mut running = RUNNING.lock().map_err(|err| err.to_string())?;
        let is_cancelled = CANCELLED
            .lock()
            .map(|mut cancelled| cancelled.remove(&request_id))
            .unwrap_or_default();
        if is_cancelled {
            let _ = child.kill();
        }
        running.insert(request_id.clone(), child);
    }

    // Stdin and stderr run on their own threads so a full pipe never blocks the stdout reader.
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });
    // The watchdog wakes on the first output line, or when the reader drops the sender at the end.
    let (first_output_sender, first_output_receiver) = mpsc::channel::<()>();
    let is_timed_out = Arc::new(AtomicBool::new(false));
    {
        let is_timed_out = is_timed_out.clone();
        let request_id = request_id.clone();
        std::thread::spawn(move || {
            if !matches!(
                first_output_receiver.recv_timeout(FIRST_OUTPUT_TIMEOUT),
                Err(RecvTimeoutError::Timeout)
            ) {
                return;
            }
            // Still registered means the stdout reader has not reached the end yet.
            if let Ok(mut running) = RUNNING.lock() {
                if let Some(child) = running.get_mut(&request_id) {
                    is_timed_out.store(true, Ordering::SeqCst);
                    let _ = child.kill();
                }
            }
        });
    }
    let stderr_reader = std::thread::spawn(move || {
        let mut output = String::new();
        let _ = stderr.read_to_string(&mut output);
        output
    });

    tauri::async_runtime::spawn_blocking(move || {
        let mut first_output_sender = Some(first_output_sender);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(sender) = first_output_sender.take() {
                let _ = sender.send(());
            }
            if on_event.send(ClaudeEvent::Line { line }).is_err() {
                break;
            }
        }
        drop(first_output_sender);
        let child = RUNNING.lock().ok().and_then(|mut running| running.remove(&request_id));
        let code = child.and_then(|mut child| child.wait().ok()).and_then(|status| status.code());
        let mut stderr = stderr_reader.join().unwrap_or_default();
        if is_timed_out.load(Ordering::SeqCst) {
            stderr = format!("{FIRST_OUTPUT_TIMEOUT_MESSAGE}\n{stderr}");
        }
        let _ = on_event.send(ClaudeEvent::Exit { code, stderr });
    });

    Ok(())
}

fn read_shell_env() -> ShellEnv {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    // The marker separates the values from anything the shell startup files print.
    let script = format!(
        "printf '{SHELL_OUTPUT_MARKER}%s\\n%s\\n' \"$(command -v claude)\" \"${CONFIG_DIR_VAR}\""
    );
    let output = Command::new(shell)
        .args(["-lic", &script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
        .unwrap_or_default();

    let mut values = output
        .split_once(SHELL_OUTPUT_MARKER)
        .map(|(_, rest)| rest)
        .unwrap_or_default()
        .lines()
        .map(|line| line.trim().to_string());
    let shell_path = values
        .next()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file());
    let config_dir = values.next().filter(|dir| !dir.is_empty());

    ShellEnv {
        claude_path: shell_path.or_else(find_fallback_claude_path),
        config_dir,
    }
}

fn find_fallback_claude_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    FALLBACK_DIRS.iter().find_map(|dir| {
        let base = if dir.starts_with('/') {
            PathBuf::from(dir)
        } else {
            home.as_ref()?.join(dir)
        };
        let candidate = base.join("claude");
        candidate.is_file().then_some(candidate)
    })
}

// ── Decks ────────────────────────────────────────────────────────────────────
// The webview hands over a file NAME and the HTML, never a path: a command that wrote to any
// path it was given would let a script in the webview overwrite any file the user owns.

/// A plain `*.html` file name: no separators, no leading dot, no control characters.
pub(crate) fn is_deck_filename(name: &str) -> bool {
    let len = name.chars().count();
    (6..=120).contains(&len)
        && name.to_ascii_lowercase().ends_with(".html")
        && !name.starts_with('.')
        && !name.contains("..")
        && !name.chars().any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
}

fn check_deck(file_name: &str, html: &str) -> Result<(), String> {
    if !is_deck_filename(file_name) {
        return Err(format!("invalid deck file name: {file_name}"));
    }
    if html.len() > DECK_MAX_BYTES {
        return Err("deck is too large".into());
    }
    Ok(())
}

pub(crate) fn write_deck_at(dir: &Path, file_name: &str, html: &str) -> Result<PathBuf, String> {
    check_deck(file_name, html)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(file_name);
    fs::write(&path, html).map_err(|e| e.to_string())?;
    Ok(path)
}

fn open_path(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// "Open in browser": write into the app's own decks folder, then open with the default app.
#[tauri::command]
pub fn open_deck(app: AppHandle, file_name: String, html: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(DECK_DIR_NAME);
    let path = write_deck_at(&dir, &file_name, &html)?;
    open_path(&app, &path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// "Save as…": native save panel opened FROM RUST (the page never names a path), write, open.
/// Returns None when the user cancels.
#[tauri::command]
pub async fn save_deck(app: AppHandle, file_name: String, html: String) -> Result<Option<String>, String> {
    check_deck(&file_name, &html)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("HTML", &["html"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = picked.into_path().map_err(|e| e.to_string())?;
    let is_html = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html"));
    if !is_html {
        path.set_extension("html");
    }
    fs::write(&path, html).map_err(|e| e.to_string())?;
    open_path(&app, &path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{is_deck_filename, write_deck_at};
    use std::fs;

    #[test]
    fn deck_filename_rules() {
        assert!(is_deck_filename("Sprint 12 review.html"));
        assert!(is_deck_filename("tổng-kết-sprint.HTML"));
        assert!(!is_deck_filename("deck.htm"));
        assert!(!is_deck_filename("../evil.html"));
        assert!(!is_deck_filename("a/b.html"));
        assert!(!is_deck_filename("a\\b.html"));
        assert!(!is_deck_filename(".hidden.html"));
        assert!(!is_deck_filename(".html"));
        assert!(!is_deck_filename("bad\nname.html"));
        assert!(!is_deck_filename(&format!("{}.html", "x".repeat(130))));
    }

    #[test]
    fn write_deck_writes_and_rejects() {
        let dir = std::env::temp_dir().join(format!("plan-up-test-deck-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = write_deck_at(&dir, "deck.html", "<!doctype html>").unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "<!doctype html>");
        assert!(write_deck_at(&dir, "../deck.html", "x").is_err());
        let huge = "x".repeat(5 * 1024 * 1024 + 1);
        assert!(write_deck_at(&dir, "big.html", &huge).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
