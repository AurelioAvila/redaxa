// Session tokens are kept in the OS credential store (Windows Credential
// Manager via the `keyring` crate), not the webview's localStorage: the
// latter persists to a plain, unencrypted file on disk, readable by any
// other process or user account with filesystem access. This gives the
// same "stays logged in until you sign out or uninstall" behavior while
// keeping the refresh token off disk in the clear.
const KEYRING_SERVICE: &str = "com.promptshield.desktop";
const KEYRING_USER: &str = "session";

#[tauri::command]
fn secure_store_set(value: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.set_password(&value))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secure_store_get() -> Result<Option<String>, String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        },
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_store_delete() -> Result<(), String> {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        },
        Err(error) => Err(error.to_string()),
    }
}

// Silent-by-default auto-update: checked once at startup, and the user is
// asked before anything is downloaded or installed. Update artifacts are
// signed (minisign) and verified by the updater plugin against the pubkey in
// tauri.conf.json, so a compromised download host cannot ship a payload.
#[cfg(desktop)]
async fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tauri_plugin_updater::UpdaterExt;
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    let version = update.version.clone();
    let app_for_install = app.clone();
    app.dialog()
        .message(format!(
            "PromptShield {version} is available.\n\nInstall now? The app restarts when it finishes."
        ))
        .title("Update available")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and restart".into(),
            "Later".into(),
        ))
        .show(move |confirmed| {
            if !confirmed {
                return;
            }
            tauri::async_runtime::spawn(async move {
                if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                    app_for_install.restart();
                }
            });
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            secure_store_set,
            secure_store_get,
            secure_store_delete
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_dialog::init())?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    check_for_updates(handle).await;
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
