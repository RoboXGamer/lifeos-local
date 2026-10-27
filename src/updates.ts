import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { createSignal } from 'solid-js'

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createUpdater() {
  const [status, setStatus] = createSignal<UpdateStatus>({ kind: 'idle' })
  const [appVersion, setAppVersion] = createSignal('')

  let pending: Update | null = null

  async function loadVersion() {
    try {
      setAppVersion(await getVersion())
    } catch {
      setAppVersion('')
    }
  }

  /**
   * `silent` is used by the startup check: no release host yet, offline, or a
   * placeholder endpoint should not greet the user with an error banner.
   */
  async function checkNow(silent = false) {
    setStatus({ kind: 'checking' })
    try {
      const update = await check()
      pending = update
      setStatus(
        update
          ? { kind: 'available', version: update.version, notes: update.body ?? null }
          : { kind: 'current' },
      )
    } catch (e) {
      setStatus(silent ? { kind: 'idle' } : { kind: 'error', message: toMessage(e) })
    }
  }

  async function install() {
    if (!pending) return

    let total = 0
    let received = 0
    setStatus({ kind: 'downloading', percent: 0 })

    try {
      await pending.downloadAndInstall(event => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        if (event.event === 'Progress') {
          received += event.data.chunkLength
          const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
          setStatus({ kind: 'downloading', percent })
        }
      })
      setStatus({ kind: 'ready' })
      // Windows runs the installer and closes the app itself; elsewhere this
      // is what actually restarts into the new version.
      await relaunch()
    } catch (e) {
      setStatus({ kind: 'error', message: toMessage(e) })
    }
  }

  return { status, appVersion, loadVersion, checkNow, install }
}
