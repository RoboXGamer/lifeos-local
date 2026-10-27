import { createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Icon } from "../../Icon";
import { useItems } from "./context";
import { useItemPanelRoute } from "./routing";
import { itemIcon } from "./types";
import { trapTabKey } from "./focus";
import "../../pages/Organization.css";

export function SearchPanel(props: { onClose: () => void }) {
  const items = useItems();
  const panel = useItemPanelRoute();
  const navigate = useNavigate();
  const [input, setInput] = createSignal("");
  const results = () => {
    const query = input().trim().toLowerCase();
    if (!query) return [];
    return items.activeItems
      .filter((item) => {
        const area =
          items.areas().find((entry) => entry._id === item.areaId)?.name ??
          "Inbox";
        return `${item.title} ${item.description ?? ""} ${item.type ?? ""} ${item.tags.join(" ")} ${area}`
          .toLowerCase()
          .includes(query);
      })
      .slice(0, 12);
  };
  const open = (itemId: string) => {
    props.onClose();
    panel.openItem(itemId);
  };
  const viewAll = () => {
    const query = input().trim();
    props.onClose();
    void navigate(`/app/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <section
      class="search-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Search Items"
      onKeyDown={trapTabKey}
      onClick={(event) => event.stopPropagation()}
    >
      <div class="search-input-row">
        <Icon name="search" size={19} />
        <input
          id="global-search-input"
          value={input()}
          placeholder="Search titles, notes, types, tags, and Areas…"
          autocomplete="off"
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") props.onClose();
            if (event.key === "Enter" && input().trim()) viewAll();
          }}
        />
        <button type="button" onClick={props.onClose}>
          Esc
        </button>
      </div>
      <div class="search-results">
        <Show
          when={input().trim()}
          fallback={
            <p class="search-empty">
              Search everything in the current Workspace. Press Enter for all
              results.
            </p>
          }
        >
          <For
            each={results()}
            fallback={<p class="search-empty">No matching Items.</p>}
            keyed={(item) => item._id}
          >
            {(item) => (
              <button
                type="button"
                class="search-result"
                onClick={() => open(item()._id)}
              >
                <span>
                  <Icon name={itemIcon(item().type)} size={17} />
                </span>
                <div>
                  <strong>{item().title}</strong>
                  <small>
                    {item().type ?? "Unsorted"} ·{" "}
                    {items.areas().find((area) => area._id === item().areaId)
                      ?.name ?? "Inbox"}
                    {item().tags.length
                      ? ` · ${item().tags.slice(0, 2).join(", ")}`
                      : ""}
                  </small>
                </div>
                <Icon name="chevronRight" size={16} />
              </button>
            )}
          </For>
        </Show>
      </div>
      <Show when={input().trim()}>
        <footer class="search-panel-footer">
          <button onClick={viewAll}>
            View all results for “{input().trim()}”{" "}
            <Icon name="chevronRight" size={15} />
          </button>
        </footer>
      </Show>
    </section>
  );
}
