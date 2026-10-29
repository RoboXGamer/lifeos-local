import { Show, createSignal, onCleanup, onSettled, type ParentProps } from "solid-js";
import { ensureProfile } from "./api";
import { transaction } from "./db";
import { reload } from "./store";
import { toError } from "./query";

/**
 * Opens the local database once, creates the profile + default Workspace on
 * first launch, then renders the app. Replaces the web app's AuthProvider.
 */
export function LocalProvider(props: ParentProps) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const boot = async () => {
    try {
      await ensureProfile();
      setError(null);
      setReady(true);
    } catch (reason) {
      setError(toError(reason).message);
    }
  };

  onSettled(() => {
    void boot();
  });

  // Another running instance may have committed while this window was inactive.
  const refreshOnFocus = () => {
    if (ready()) void transaction(async () => {}, reload).catch(console.error);
  };
  window.addEventListener("focus", refreshOnFocus);
  onCleanup(() => window.removeEventListener("focus", refreshOnFocus));

  const retry = () => {
    setError(null);
    setReady(false);
    void boot();
  };

  return (
    <Show
      when={ready()}
      fallback={
        <main class="auth-bootstrap">
          <div class="auth-bootstrap-mark">L</div>
          <Show
            when={error()}
            fallback={
              <>
                <strong>Opening your Life OS</strong>
                <p>Loading your local workspace.</p>
              </>
            }
          >
            {(message) => (
              <>
                <strong>We couldn’t open your space</strong>
                <p>{message()}</p>
                <button type="button" onClick={retry}>
                  Try again
                </button>
              </>
            )}
          </Show>
        </main>
      }
    >
      {props.children}
    </Show>
  );
}
