import { createSignal, onSettled, Show } from "solid-js";
import { getStartupStatus, configureStartup } from "../../local/server-functions";
import type { StartupStatus } from "../../../server/startup.mjs";

export function StartupControl() {
  const [status, setStatus] = createSignal<StartupStatus>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  onSettled(() => { void getStartupStatus().then(setStatus).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Startup settings are unavailable.")); });
  return <section class="workspace-startup" aria-label="Background scheduling" style={{ padding: "12px 2px", "border-top": "1px solid var(--color-border)", display: "grid", gap: "8px" }}>
    <a href="/app/automations">Automation rules</a>
    <label style={{ display: "flex", "align-items": "center", gap: "9px", "font-size": ".78rem" }}><input type="checkbox" checked={status()?.enabled ?? false} disabled={busy() || !status()?.available} onChange={async event => {
      const enabled = event.currentTarget.checked;
      if (busy()) return;
      setBusy(true); setError("");
      try { setStatus(await configureStartup(enabled)); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Startup setting could not be changed."); setStatus(await getStartupStatus().catch(() => status())); }
      finally { setBusy(false); }
    }} />Start LifeOS scheduling when I sign in</label>
    <small style={{ color: "hsl(225 12% 43%)", "font-size": ".7rem" }}>{status()?.reason ?? (status() ? "Runs quietly with the app window closed. Powered-off time is caught up on resume." : "Checking startup availability…")}</small>
    <Show when={error()}><small role="alert">{error()}</small></Show>
  </section>;
}
