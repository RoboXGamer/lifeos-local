import { createSignal, For, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { api } from "../local/api";
import { Icon } from "../Icon";
import { createQuery } from "../local";
import { ItemRow } from "../features/items/ItemRow";
import {
  useItems,
  type ItemType,
} from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import { useWorkspaces } from "../features/workspaces/context";
import "./Retrieval.css";

const types: Array<ItemType | "All"> = [
  "All",
  "Task",
  "Note",
  "Event",
  "Expense",
  "Income",
];

export default function Search() {
  const items = useItems();
  const workspaces = useWorkspaces();
  const panel = useItemPanelRoute();
  const [searchParams, setSearchParams] = useSearchParams<{ q: string }>();
  const query = () => (searchParams.q ?? "").trim();
  const [draft, setDraft] = createSignal(query());
  const [type, setType] = createSignal<ItemType | "All">("All");
  const results = createQuery(
    api.items.search,
    () => {
      const workspaceId = workspaces.state.activeWorkspaceId;
      return workspaceId && query()
        ? { workspaceId, searchTerm: query(), limit: 60, type: type() === "All" ? undefined : type() as ItemType }
        : "skip";
    },
    { initialValue: [] },
  );
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setSearchParams({ q: draft().trim() }, { replace: true });
  };

  return (
    <section class="retrieval-page search-page">
      <header class="retrieval-header">
        <h2>Search</h2>
      </header>
      <form class="full-search" onSubmit={submit}>
        <Icon name="search" size={20} />
        <input
          value={draft()}
          autofocus
          placeholder="Search your Life OS…"
          onInput={(event) => setDraft(event.currentTarget.value)}
        />
        <button type="submit">Search</button>
      </form>
      <div class="full-search-filters">
        <For each={types}>
          {(value) => (
            <button
              class={{ active: type() === value }}
              onClick={() => setType(value)}
            >
              {value}
            </button>
          )}
        </For>
        <span>{(results() ?? []).length} results</span>
      </div>
      <Show
        when={query()}
        fallback={
          <div class="retrieval-empty">
            <span>
              <Icon name="search" size={25} />
            </span>
            <h3>Search everything</h3>
            <p>Try a title, description, Item type, tag, or Area name.</p>
          </div>
        }
      >
        <div class="retrieval-scroll search-result-list">
          <For
            each={results() ?? []}
            fallback={
              <div class="retrieval-empty">
                <h3>No results</h3>
                <p>Try another phrase or Item type.</p>
              </div>
            }
            keyed={(item) => item._id}
          >
            {(item) => (
              <ItemRow
                item={item()}
                areaName={
                  items.areas().find((area) => area._id === item().areaId)
                    ?.name ?? "Inbox"
                }
                onOpen={(id) => panel.openItem(id)}
                onToggleTask={(id, done) => void items.setTaskDone(id, done)}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
