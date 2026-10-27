import { For, Show, createSignal, onSettled } from "solid-js";
import { Icon } from "../../Icon";
import { createConnectionState } from "../../local";
import { useItems } from "./context";
import { useItemPanelRoute } from "./routing";
import { itemIcon } from "./types";
import { trapTabKey } from "./focus";
import "./InboxPanel.css";

export function InboxPanel(props: {
  open: boolean;
  docked: boolean;
  onClose: (returnFocus?: boolean) => void;
}) {
  const items = useItems();
  const panel = useItemPanelRoute();
  const connection = createConnectionState();
  const [title, setTitle] = createSignal("");
  const [dragging, setDragging] = createSignal(false);
  let captureInput!: HTMLInputElement;

  onSettled(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.open) props.onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  const capture = async (event: SubmitEvent) => {
    event.preventDefault();
    const cleanTitle = title().trim();
    if (!cleanTitle) return;
    setTitle("");
    const saved = await items.quickCapture(cleanTitle);
    if (!saved) setTitle(cleanTitle);
    queueMicrotask(() => captureInput?.focus());
  };

  return (
    <div
      class={["inbox-panel-backdrop", { dragging: dragging() }]}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <aside
        class="inbox-panel"
        role={
          props.open ? (props.docked ? "complementary" : "dialog") : undefined
        }
        aria-modal={props.open && !props.docked ? "true" : undefined}
        aria-hidden={props.open ? undefined : "true"}
        inert={!props.open}
        aria-label="Inbox"
        onKeyDown={(event) => {
          if (!props.docked) trapTabKey(event);
        }}
      >
        <header>
          <div>
            <span>
              <Icon name="inbox" size={19} />
            </span>
            <div>
              <small>Quick capture</small>
              <h2>Inbox</h2>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Inbox"
            onClick={() => props.onClose()}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <form class="inbox-capture" onSubmit={capture}>
          <label for="quick-capture">Capture without organizing</label>
          <div>
            <input
              id="quick-capture"
              ref={captureInput}
              value={title()}
              maxlength="200"
              placeholder="What is on your mind?"
              onInput={(event) => setTitle(event.currentTarget.value)}
            />
            <button type="submit" aria-label="Add to Inbox">
              <Icon name="plus" size={18} />
            </button>
          </div>
          <p>
            Press <kbd>Ctrl</kbd> <span>+</span> <kbd>Space</kbd> anywhere
          </p>
        </form>

        <Show
          when={
            connection().hasEverConnected && !connection().isWebSocketConnected
          }
        >
          <p class="inbox-connection" role="status">
            <span />
            Reconnecting. Your list is still available.
          </p>
        </Show>

        <Show when={items.error()}>
          {(message) => (
            <p class="inbox-error" role="alert">
              {message()}
              <button type="button" onClick={items.clearError}>
                Dismiss
              </button>
            </p>
          )}
        </Show>

        <div class="inbox-list-heading">
          <span>Unsorted</span>
          <strong>{items.inboxItems().length}</strong>
        </div>
        <div class="inbox-list">
          <For
            each={items.inboxItems()}
            fallback={
              <div class="inbox-empty">
                <span>
                  <Icon name="sparkle" size={23} />
                </span>
                <h3>Your mind is clear</h3>
                <p>Captured thoughts will wait here until you organize them.</p>
              </div>
            }
            keyed={(item) => item._id}
          >
            {(item) => (
              <button
                type="button"
                class="inbox-item"
                draggable="true"
                onDragStart={(event) => {
                  setDragging(true);
                  event.dataTransfer?.setData(
                    "application/x-lifeos-item",
                    item()._id,
                  );
                  if (event.dataTransfer)
                    event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragging(false)}
                onClick={() => {
                  panel.openItem(item()._id);
                }}
              >
                <span>
                  <Icon name={itemIcon(item().type)} size={17} />
                </span>
                <div>
                  <strong>{item().title}</strong>
                  <small>
                    {item().type
                      ? `${item().type} · ready to organize`
                      : "Unsorted · choose a type when ready"}
                  </small>
                </div>
                <Icon name="chevronRight" size={16} />
              </button>
            )}
          </For>
        </div>

        <Show when={items.inboxItems().length >= 3}>
          <div class="inbox-account-prompt">
            <span>
              <Icon name="sparkle" size={17} />
            </span>
            <div>
              <strong>Kept on this device</strong>
              <p>
                Everything you capture lives in a local database. No account,
                no sync.
              </p>
            </div>
          </div>
        </Show>
      </aside>
    </div>
  );
}
