# Windows testing installer

Build on Windows with Rust, the Windows C++ build tools, Node and pnpm installed:

```powershell
pnpm install --frozen-lockfile
pnpm build:msi
```

Tauri's WiX bundler creates the MSI under `src-tauri/target/release/bundle/msi/`. The version comes from `src-tauri/tauri.conf.json`; the default architecture is the Rust build target. The build may download WiX. See [Tauri's Windows installer guide](https://v2.tauri.app/distribute/windows-installer/) for prerequisites, including Windows' VBScript optional feature.

This testing build does not generate updater artifacts and does not require the Tauri updater signing key. Unless Windows Authenticode signing is separately configured, the MSI is unsigned and Windows may show a warning. An updater signature and a Windows code-signing signature are different things.

Copy the MSI to the target Windows machine and run it. The installer uses the default WebView2 bootstrapper: if WebView2 is missing, installation requires an internet connection. Launch LifeOS, create an item, close and reopen it, and check persistence, search and archive/restore. Data is local to that machine in `%APPDATA%\dev.a5in.lifeos\lifeos.db`; neither the developer's database nor the signing key is bundled.

For subsequent tests, record the installed version, install a newer version, and verify that data survives the upgrade. Check the database separately after uninstalling; uninstall and upgrade behavior on a second machine has not yet been verified. Back up the database before any uninstall test with data you want to keep.

The app's current update endpoint is `127.0.0.1:8123` on the machine running it. Copying this MSI to another machine does not give that machine a remote update service.
