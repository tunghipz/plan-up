//! iOS-only plugin (design-docs/ios-backup-folder.md): keeps a security-scoped
//! bookmark of the folder the user picked and lists / reads backup files in it.
//! Read-only by design — there is no write command.

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_backup_folder);

/// Handle to the Swift side; the app calls `run_mobile_plugin` on it.
pub struct BackupFolder<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("backup-folder")
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_backup_folder)?;
                app.manage(BackupFolder(handle));
            }
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}
