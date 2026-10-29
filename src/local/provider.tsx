import { Show, createSignal, onCleanup, onSettled, type ParentProps } from "solid-js";
import { enableRemoteMutations } from "./api";
import { applySnapshot } from "./store";
import { callMutation, watchState } from "./server-functions";
import { toError } from "./query";

/**
 * Opens the local database once, creates the profile + default Workspace on
 * first launch, then renders the app. Replaces the web app's AuthProvider.
 */
export function LocalProvider(props: ParentProps) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let iterator: AsyncIterator<import('./server-functions').StateUpdate> | undefined;
  let generation = 0;
  const boot = async () => {
    const current = ++generation;
    try {
      iterator = watchState()[Symbol.asyncIterator]();
      while (current === generation) {
        const next = await iterator.next();
        if (next.done || current !== generation) break;
        applySnapshot(next.value);
        enableRemoteMutations(callMutation);
        setError(null);
        setReady(true);
      }
    } catch (reason) {
      if (current !== generation) return;
      setError(toError(reason).message);
      setReady(false);
    }
  };

  onSettled(() => {
    void boot();
  });

  onCleanup(() => { generation++; void iterator?.return?.(); });

  const retry = () => {
    generation++;
    void iterator?.return?.();
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
