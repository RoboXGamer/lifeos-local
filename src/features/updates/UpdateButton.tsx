import { Show, createSignal, onSettled } from "solid-js";
import { relaunch } from "@tauri-apps/plugin-process";
import { Icon, type AppIconName } from "../../Icon";
import { createUpdater } from "../../updates";
import "./UpdateButton.css";

/**
 * Lives at the bottom of the sidebar and renders nothing unless there is
 * something to say: a pending update, a download in flight, a finished
 * download, or a failed install.
 *
 * The startup check is silent on purpose. With no release host configured yet,
 * an offline machine or a placeholder endpoint must not greet people with an
 * error they cannot act on.
 */
export function UpdateButton() {
  const updater = createUpdater();
  const [open, setOpen] = createSignal(false);

  const status = updater.status;

  const available = () => {
    const current = status();
    return current.kind === "available" ? current : undefined;
  };
  const downloading = () => {
    const current = status();
    return current.kind === "downloading" ? current : undefined;
  };
  const failed = () => {
    const current = status();
    return current.kind === "error" ? current : undefined;
  };

  const visible = () =>
    available() !== undefined ||
    downloading() !== undefined ||
    failed() !== undefined ||
    status().kind === "ready";

  const triggerLabel = () => {
    const current = status();
    switch (current.kind) {
      case "available":
        return `Update available: ${current.version}`;
      case "downloading":
        return `Downloading update: ${current.percent}%`;
      case "ready":
        return "Update ready — restart to finish";
      case "error":
        return "Update failed — open details";
      default:
        return "App update";
    }
  };

  const triggerIcon = (): AppIconName => {
    if (status().kind === "error") return "alert";
    if (status().kind === "ready") return "refresh";
    return "download";
  };

  onSettled(() => {
    void updater.loadVersion();
    void updater.checkNow(true);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <Show when={visible()}>
      <div class="update-menu">
        <button
          type="button"
          class={["update-trigger", `is-${status().kind}`]}
          aria-label={triggerLabel()}
          title={triggerLabel()}
          aria-expanded={open() ? "true" : "false"}
          onClick={() => setOpen((value) => !value)}
        >
          <Show
            when={downloading()}
            fallback={<Icon name={triggerIcon()} size={20} />}
          >
            {(state) => <span class="update-percent">{state().percent}%</span>}
          </Show>
          <Show when={!downloading()}>
            <span class="update-dot" />
          </Show>
        </button>

        <Show when={open()}>
          <button
            type="button"
            class="update-backdrop"
            aria-label="Close update panel"
            onClick={() => setOpen(false)}
          />
          <section class="update-popover" aria-label="App update">
            <header>
              <div>
                <span>App update</span>
                <strong>
                  {available()
                    ? "A new version is ready"
                    : downloading()
                      ? "Downloading…"
                      : status().kind === "ready"
                        ? "Ready to restart"
                        : "Update failed"}
                </strong>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </header>

            <Show when={available()}>
              {(state) => (
                <>
                  <p class="update-version">
                    {updater.appVersion()
                      ? `v${updater.appVersion()} → v${state().version}`
                      : `v${state().version}`}
                  </p>
                  <Show when={state().notes}>
                    {(notes) => <p class="update-notes">{notes()}</p>}
                  </Show>
                  <div class="update-actions">
                    <button
                      type="button"
                      class="primary"
                      onClick={() => void updater.install()}
                    >
                      Install update
                    </button>
                    <button type="button" onClick={() => setOpen(false)}>
                      Later
                    </button>
                  </div>
                </>
              )}
            </Show>

            <Show when={downloading()}>
              {(state) => (
                <>
                  <div class="update-progress" role="presentation">
                    <span style={{ width: `${state().percent}%` }} />
                  </div>
                  <p class="update-status">
                    Downloading in the background. You can keep working.
                  </p>
                </>
              )}
            </Show>

            <Show when={status().kind === "ready"}>
              <p class="update-status">
                The new version is installed. Restart to use it.
              </p>
              <div class="update-actions">
                <button
                  type="button"
                  class="primary"
                  onClick={() => void relaunch()}
                >
                  Restart now
                </button>
              </div>
            </Show>

            <Show when={failed()}>
              {(state) => (
                <>
                  <p class="update-error">{state().message}</p>
                  <div class="update-actions">
                    <button
                      type="button"
                      onClick={() => void updater.checkNow()}
                    >
                      Try again
                    </button>
                    <button type="button" onClick={() => setOpen(false)}>
                      Dismiss
                    </button>
                  </div>
                </>
              )}
            </Show>
          </section>
        </Show>
      </div>
    </Show>
  );
}
