#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.visible = false;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            let resource_dir = app.path().resource_dir()?;
            let data_dir = app.path().app_config_dir()?;
            #[cfg(debug_assertions)]
            let data_dir = std::env::var_os("LIFEOS_DEV_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(data_dir);
            #[cfg(debug_assertions)]
            let executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!(
                    "lifeos-{}{}",
                    env!("TAURI_ENV_TARGET_TRIPLE"),
                    std::env::consts::EXE_SUFFIX
                ));
            #[cfg(not(debug_assertions))]
            let executable = resource_dir.join(format!("lifeos{}", std::env::consts::EXE_SUFFIX));
            #[cfg(debug_assertions)]
            let client_dir =
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/client");
            #[cfg(not(debug_assertions))]
            let client_dir = resource_dir.join("lifeos-client");
            #[cfg(debug_assertions)]
            let mut command = if std::env::var_os("LIFEOS_DEV_SERVICE_URL").is_some() {
                let entry = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../server/launcher.mjs");
                let mut node = Command::new("node");
                node.arg(&entry).env("LIFEOS_DEV_ENTRY", entry);
                node
            } else {
                Command::new(executable)
            };
            #[cfg(not(debug_assertions))]
            let mut command = Command::new(executable);
            command
                .arg("connection")
                .env("LIFEOS_DATA_DIR", data_dir)
                .env("LIFEOS_CLIENT_DIR", client_dir);
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            let output = command.output()?;
            if !output.status.success() {
                return Err(format!(
                    "Unable to start LifeOS service: {}",
                    String::from_utf8_lossy(&output.stderr)
                )
                .into());
            }
            let info: serde_json::Value = serde_json::from_slice(&output.stdout)?;
            let port = info["port"].as_u64().ok_or("Missing service port")?;
            let token = info["token"].as_str().ok_or("Missing service token")?;
            #[cfg(debug_assertions)]
            let origin = if std::env::var_os("LIFEOS_DEV_SERVICE_URL").is_some() {
                "http://127.0.0.1:1420".to_string()
            } else {
                format!("http://127.0.0.1:{port}")
            };
            #[cfg(not(debug_assertions))]
            let origin = format!("http://127.0.0.1:{port}");
            let url = format!("{origin}/auth?token={token}").parse()?;
            let window = app.get_webview_window("main").ok_or("Missing main window")?;
            window.navigate(url)?;
            if std::env::var_os("LIFEOS_TEST_HIDDEN").is_none() {
                window.show()?;
            }
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}
