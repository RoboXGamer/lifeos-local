# Updates

Life OS updates are served from this machine. There is no release host.

## Publish a version

```bash
# builds, signs, and writes latest.json
node scripts/publish-update.mjs --version 0.1.1 --notes "Faster Areas, calmer capture"
```

- The build is a signed NSIS bundle (`--bundles nsis`) using
  `~/.tauri/lifeos.key`, or `TAURI_SIGNING_PRIVATE_KEY` when set.
- Artifacts land in `src-tauri/target/release/bundle/updates/` (gitignored):
  `LifeOS_<version>_x64-setup.exe`, its `.sig`, and `latest.json`.
- The repo version is restored after the build, so the app you run locally
  keeps its old version and will see the published one as an update.

## Serve it

```bash
pnpm update:serve
```

Serves that folder at `http://127.0.0.1:8123/latest.json`. Port 8123 is what
`plugins.updater.endpoints` in `src-tauri/tauri.conf.json` points at.

## Test the flow

1. `pnpm update:serve`
2. Start the app built with the previous version (`pnpm tauri dev` counts).
3. The sidebar shows a download button above the avatar.
4. Open it → **Install update** → download → the NSIS installer runs and the
   app restarts on the new version.

## Notes

- The endpoint is plain HTTP on localhost, so
  `plugins.updater.dangerousInsecureTransportProtocol` is `true`. Release builds
  refuse non-HTTPS endpoints without it. If updates ever come from another
  machine, prefer HTTPS and turn this off.
- The signing key is intentionally outside the repo. Keep the matching public
  key in `plugins.updater.pubkey`.
- `pnpm update:serve` is a thin wrapper around
  `uv run --no-project scripts/serve-updates.py <folder> 8123`.

## Troubleshooting

If bundling fails with `failed to bundle project: timeout: global` while
downloading `nsis-3.13.zip`, the bundler could not reach GitHub. Pre-seed its
cache instead of retrying:

```bash
# Windows: %LOCALAPPDATA%\tauri
TOOLS="$LOCALAPPDATA/tauri"
mkdir -p "$TOOLS" && cd "$TOOLS"
curl -LO https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip
unzip -q nsis-3.13.zip && mv nsis-3.13 NSIS
mkdir -p NSIS/Plugins/x86-unicode/additional
curl -L -o NSIS/Plugins/x86-unicode/additional/nsis_tauri_utils.dll \
  https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll
```

The bundler checks these exact hashes and then skips the download:

- `nsis-3.13.zip` SHA1 `DB14F8AF2EA346B786C6AE19343F61AAF5E09B8E`
- `NSIS/NSIS.exe` SHA1 `6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2`
- `nsis_tauri_utils.dll` SHA1 `75197FEE3C6A814FE035788D1C34EAD39349B860`
