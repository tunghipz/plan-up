// No JS-facing commands: the app's own `backup_folder_*` commands (lib.rs) call
// the Swift side through `PluginHandle::run_mobile_plugin`.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
