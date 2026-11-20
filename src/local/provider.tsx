import { Show, createEffect, createMemo, createSignal, type ParentProps } from "solid-js";
import { enableRemoteMutations } from "./api";
import { applySnapshot } from "./store";
import { callMutation, watchState, type StateUpdate } from "./server-functions";
import { toError } from "./query";

/** Wait for the local service's first snapshot before rendering the app. */
export function LocalProvider(props: ParentProps) {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [attempt, setAttempt] = createSignal(0);
  const snapshot = createMemo<StateUpdate | undefined>(() => {
    attempt();
    return watchState();
  }, { ssrSource: "client", loadingValue: undefined });

  createEffect(snapshot, {
    effect(update) {
      if (!update) return;
      applySnapshot(update);
      enableRemoteMutations(callMutation);
      setError(null);
      setReady(true);
    },
    error(reason) {
      setError(toError(reason).message);
      setReady(false);
    },
  });

  const retry = () => {
    setError(null);
    setReady(false);
    setAttempt((previous) => previous + 1);
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
