# Auto-update flow

LifeOS checks a static JSON manifest, downloads a signed installer, verifies the
signature, installs it, and relaunches.

## What is wired where

| Piece | Location |
| --- | --- |
| Update check / download / install state | `src/update.ts` → `createUpdater()` |
| UI (status, progress bar, install button) | `src/App.tsx`, `.updates` card |
| Startup check (silent, failures hidden) | `onSettled(() => updater.checkNow(true))` |
| Rust plugins | `src-tauri/src/lib.rs` (`updater`, `process`) |
| Permissions | `src-tauri/capabilities/default.json` (`updater:default`, `process:allow-restart`) |
| Endpoint + public key | `src-tauri/tauri.conf.json` → `plugins.updater` |
| Signed artifacts | `bundle.createUpdaterArtifacts: true` |

Statuses: `idle → checking → current | available → downloading → ready` and
`error`. The startup check is silent so an offline launch or a missing release
host never shows an error.

## Signing key (already generated)

- Private key: `C:\Users\A5IN\.tauri\lifeos.key` — **never commit it** (it lives outside the repo).
- Public key: embedded in `tauri.conf.json` (`plugins.updater.pubkey`).
- Dev key has **no password**. Before a public release, generate a new key with a
  password: `pnpm tauri signer generate -w ~/.tauri/lifeos-release.key`.
- Lose the private key and you can never sign another update for existing installs.

## Release build

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/lifeos.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm tauri build
```

Without those env vars the build fails, because updater artifacts must be signed.

Output in `src-tauri/target/release/bundle/`:

```
msi/LifeOS_0.1.0_x64_en-US.msi
msi/LifeOS_0.1.0_x64_en-US.msi.zip       + .sig   <- updater payload
nsis/LifeOS_0.1.0_x64-setup.exe
nsis/LifeOS_0.1.0_x64-setup.nsis.zip     + .sig   <- updater payload
```

Use the **NSIS** payload for updates: it installs per-user, so an update does not
trigger a UAC prompt.

## Manifest (`latest.json`)

Host this next to the artifacts:

```json
{
  "version": "0.1.1",
  "notes": "First update through the pipe.",
  "pub_date": "2026-10-27T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of LifeOS_0.1.1_x64-setup.nsis.zip.sig>",
      "url": "https://your-host/LifeOS_0.1.1_x64-setup.nsis.zip"
    }
  }
}
```

`signature` is the text inside the `.sig` file, not the file path.
Point `plugins.updater.endpoints` at this file.

## Testing locally

`pnpm tauri dev` **cannot** self-update — the updater needs a real installed build.

1. Build and install v0.1.0 (env vars above), keep it as the running app.
2. Bump `version` in `src-tauri/tauri.conf.json` to `0.1.1`, build again.
3. Assemble a test folder: the `0.1.1` `.nsis.zip`, its `.sig` content in
   `latest.json`, and run:

   ```bash
   uv run --no-project scripts/serve-updates.py path/to/test-folder 8000
   ```

4. Point the endpoint at `http://127.0.0.1:8000/latest.json` and add
   `"dangerousInsecureTransportProtocol": true` to `plugins.updater` for that
   build only — HTTPS is required otherwise.
5. Launch the installed 0.1.0, hit **Check for updates**, watch it download and
   restart into 0.1.1. Remove the insecure flag afterwards.

## Hosting options

- **GitHub Releases** — free, and `tauri-action` can publish the artifacts and
  `latest.json` automatically on tag push (recommended for a personal project).
- **Any static host** (R2, S3, Netlify, your own server) — upload `latest.json`
  plus the `.nsis.zip` and keep the URL stable.
- Rollout control is per-platform only: the manifest can advertise a version to
  Windows and an older one elsewhere, but there is no staged percentage rollout.

## Gotchas

- Forgetting to bump `version` in `tauri.conf.json` means the app thinks it is
  already current.
- Signature mismatch (`signature verification failed`) means `latest.json` and
  the installer came from different keys or the `.sig` was edited.
- Endpoint changes need a rebuild; the URL is baked into the binary.
- The updater artifacts are only produced when `createUpdaterArtifacts` is on
  **and** the signing key env vars are set.
