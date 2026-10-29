#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

mod transaction;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_todos",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "lifeos_domain",
            sql: include_str!("../migrations/0002_lifeos.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let mut context = tauri::generate_context!();
    for window in &mut context.config_mut().app.windows {
        window.visible = false;
    }
    tauri::Builder::default()
        .manage(transaction::TransactionState::default())
        .invoke_handler(tauri::generate_handler![
            transaction::begin,
            transaction::execute,
            transaction::select,
            transaction::finish,
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:lifeos.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            let resource_dir = app.path().resource_dir()?;
            let data_dir = app.path().app_config_dir()?;
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
            let url = format!("http://127.0.0.1:{port}/auth?token={token}").parse()?;
            app.get_webview_window("main")
                .ok_or("Missing main window")?
                .navigate(url)?;
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if std::env::var_os("LIFEOS_TEST_HIDDEN").is_none() && payload.url().host_str() == Some("127.0.0.1") && payload.url().path() == "/" {
                let _ = webview.show();
            }
        })
        .run(context)
        .expect("error while running tauri application");
}
