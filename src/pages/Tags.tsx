import { createSignal, For, Show } from "solid-js";
import { api } from "../local/api";
import type { Id } from "../local/types";
import { createMutation, createQuery, toError } from "../local";
import { Icon } from "../Icon";
import { ItemTableHeader, ItemTableRow } from "../features/items/ItemTable";
import { useItems } from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import { useWorkspaces } from "../features/workspaces/context";
import "./Organization.css";
import "./Retrieval.css";

export default function Tags() {
  const workspaces = useWorkspaces();
  const items = useItems();
  const panel = useItemPanelRoute();
  const source = createQuery(
    api.tags.listWithCounts,
    () => {
      const workspaceId = workspaces.state.activeWorkspaceId;
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const renameMutation = createMutation(api.tags.rename);
  const removeMutation = createMutation(api.tags.remove);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const selectedTag = () =>
    (source() ?? []).find((tag) => tag._id === selected()) ?? source()?.[0];
  const taggedItems = () => {
    const tag = selectedTag();
    if (!tag) return [];
    return items.activeItems.filter((item) =>
      item.tags.some((value) => value.toLowerCase() === tag.normalizedName),
    );
  };
  const beginRename = (tagId: Id<"tags">, currentName: string) => {
    setEditing(tagId);
    setName(currentName);
    setError(null);
  };
  const saveRename = async (tagId: Id<"tags">) => {
    try {
      await renameMutation({ tagId, name: name() });
      setEditing(null);
    } catch (reason) {
      setError(toError(reason).message);
    }
  };
  const remove = async (tagId: Id<"tags">) => {
    try {
      await removeMutation({ tagId });
      if (selected() === tagId) setSelected(null);
    } catch (reason) {
      setError(toError(reason).message);
    }
  };

  return (
    <section class="organization-page">
      <header class="organization-header">
        <h2>Tags</h2>
      </header>
      <Show when={error()}>
        {(message) => <p class="organization-message">{message()}</p>}
      </Show>
      <div class="tag-layout">
        <div class="tag-list">
          <For each={source() ?? []} keyed={(tag) => tag._id}>
            {(tag) => (
              <article
                class={[
                  "tag-card",
                  { selected: selectedTag()?._id === tag()._id },
                ]}
              >
                <button type="button" onClick={() => setSelected(tag()._id)}>
                  <Icon name="tag" size={15} />
                  <span>{tag().name}</span>
                </button>
                <small>{tag().countIsLimited ? "300+" : tag().itemCount}</small>
                <Show
                  when={editing() === tag()._id}
                  fallback={
                    <div class="tag-actions">
                      <button
                        type="button"
                        onClick={() => beginRename(tag()._id, tag().name)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={tag().itemCount > 0}
                        title={
                          tag().itemCount > 0
                            ? "Remove this Tag from its Items first"
                            : "Delete unused Tag"
                        }
                        onClick={() => remove(tag()._id)}
                      >
                        Delete
                      </button>
                    </div>
                  }
                >
                  <form
                    class="tag-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename(tag()._id);
                    }}
                  >
                    <input
                      value={name()}
                      onInput={(event) => setName(event.currentTarget.value)}
                      aria-label={`Rename ${tag().name}`}
                    />
                    <button type="submit">Save</button>
                  </form>
                </Show>
              </article>
            )}
          </For>
        </div>
        <div class="tag-results item-table-shell">
          <div class="tag-result-heading">
            <h3>#{selectedTag()?.name ?? "Select a Tag"}</h3>
            <small>{taggedItems().length} active Items</small>
          </div>
          <Show
            when={taggedItems().length > 0}
            fallback={<p class="search-empty">No active Items use this Tag.</p>}
          >
            <ItemTableHeader />
            <div class="area-product-list">
              <For each={taggedItems()} keyed={(item) => item._id}>
                {(item) => (
                  <section class="area-family">
                    <ItemTableRow
                      item={item()}
                      onOpen={(id) => panel.openItem(id)}
                      onToggleTask={(id, done) =>
                        void items.setTaskDone(id, done)
                      }
                    />
                  </section>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}
