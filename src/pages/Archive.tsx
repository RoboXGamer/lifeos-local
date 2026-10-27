import { createSignal, For, Show, type Element } from "solid-js";
import { api } from "../local/api";
import type { Id } from "../local/types";
import { createMutation, createQuery, toError } from "../local";
import { Icon, type IconName } from "../Icon";
import { useItems } from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import { itemIcon } from "../features/items/types";
import { useWorkspaces } from "../features/workspaces/context";
import "./Lifecycle.css";

type Removal =
  | { kind: "item"; id: Id<"items">; name: string }
  | { kind: "area"; id: Id<"areas">; name: string }
  | { kind: "workspace"; id: Id<"workspaces">; name: string };

export default function Archive() {
  const workspaces = useWorkspaces();
  const items = useItems();
  const panel = useItemPanelRoute();
  const archivedAreas = createQuery(
    api.areas.listArchived,
    () => {
      const workspaceId = workspaces.state.activeWorkspaceId;
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const areaArchiveMutation = createMutation(api.areas.setArchived);
  const areaRemoveMutation = createMutation(api.areas.remove);
  const itemRemoveMutation = createMutation(api.items.remove);
  const workspaceRemoveMutation = createMutation(api.workspaces.remove);
  const [removal, setRemoval] = createSignal<Removal | null>(null);
  const [confirmation, setConfirmation] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const selectedItemImpact = createQuery(api.items.removalImpact, () => {
    const selected = removal();
    return selected?.kind === "item" ? { itemId: selected.id } : "skip";
  });
  const selectedAreaImpact = createQuery(api.areas.removalImpact, () => {
    const selected = removal();
    return selected?.kind === "area" ? { areaId: selected.id } : "skip";
  });
  const selectedWorkspaceImpact = createQuery(
    api.workspaces.removalImpact,
    () => {
      const selected = removal();
      return selected?.kind === "workspace"
        ? { workspaceId: selected.id }
        : "skip";
    },
  );
  const visibleArchivedItems = () => {
    const archivedIds = new Set(items.archivedItems.map((item) => item._id));
    return items.archivedItems.filter(
      (item) => item.parentId === null || !archivedIds.has(item.parentId),
    );
  };
  const openRemoval = (target: Removal) => {
    setRemoval(target);
    setConfirmation("");
    setError(null);
  };
  const affectedText = () => {
    const selected = removal();
    if (selected?.kind === "item") {
      return `${selectedItemImpact()?.itemCount ?? "…"} Item${selectedItemImpact()?.itemCount === 1 ? "" : "s"}`;
    }
    if (selected?.kind === "area") {
      return `${selectedAreaImpact()?.itemCount ?? "…"} Items and this Area`;
    }
    return `${selectedWorkspaceImpact()?.areaCount ?? "…"} Areas and ${selectedWorkspaceImpact()?.itemCount ?? "…"} Items`;
  };
  const confirmRemoval = async () => {
    const selected = removal();
    if (!selected || deleting()) return;
    setDeleting(true);
    try {
      if (selected.kind === "item") {
        await itemRemoveMutation({
          itemId: selected.id,
          confirmation: confirmation(),
        });
      } else if (selected.kind === "area") {
        await areaRemoveMutation({
          areaId: selected.id,
          confirmation: confirmation(),
        });
      } else {
        await workspaceRemoveMutation({
          workspaceId: selected.id,
          confirmation: confirmation(),
        });
      }
      setRemoval(null);
    } catch (reason) {
      setError(toError(reason).message);
    } finally {
      setDeleting(false);
    }
  };

  const archiveSection = (title: string, count: number, content: Element) => (
    <section class="archive-section">
      <header>
        <h3>{title}</h3>
        <small>{count}</small>
      </header>
      <Show
        when={count > 0}
        fallback={<p class="search-empty">Nothing archived here.</p>}
      >
        {content}
      </Show>
    </section>
  );

  return (
    <section class="lifecycle-page">
      <header class="lifecycle-header">
        <h2>Archive</h2>
      </header>
      <Show when={error()}>
        {(message) => <p class="organization-message">{message()}</p>}
      </Show>
      <div class="lifecycle-scroll">
        {archiveSection(
          "Items",
          visibleArchivedItems().length,
          <For each={visibleArchivedItems()} keyed={(item) => item._id}>
            {(item) => (
              <article class="archive-row">
                <span>
                  <Icon name={itemIcon(item().type)} size={17} />
                </span>
                <button
                  type="button"
                  class="archive-row-main"
                  onClick={() => panel.openItem(item()._id, "archived")}
                >
                  <strong>{item().title}</strong>
                  <span>
                    {item().type ?? "Unsorted"} ·{" "}
                    <Show
                      when={item().parentId === null}
                      fallback={<>Child Item</>}
                    >
                      {
                        items.archivedItems.filter(
                          (child) => child.parentId === item()._id,
                        ).length
                      }{" "}
                      children
                    </Show>
                  </span>
                </button>
                <div class="archive-actions">
                  <button
                    type="button"
                    onClick={() => items.setArchived(item()._id, false)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      openRemoval({
                        kind: "item",
                        id: item()._id,
                        name: item().title,
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            )}
          </For>,
        )}
        {archiveSection(
          "Areas",
          archivedAreas()?.length ?? 0,
          <For each={archivedAreas() ?? []} keyed={(area) => area._id}>
            {(area) => (
              <article class="archive-row">
                <span style={{ color: area().color }}>
                  <Icon name={area().icon as IconName} size={17} />
                </span>
                <div class="archive-row-main">
                  <strong>{area().name}</strong>
                  <span>Area and its assigned Items</span>
                </div>
                <div class="archive-actions">
                  <button
                    type="button"
                    onClick={() =>
                      areaArchiveMutation({
                        areaId: area()._id,
                        archived: false,
                      })
                    }
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      openRemoval({
                        kind: "area",
                        id: area()._id,
                        name: area().name,
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            )}
          </For>,
        )}
        {archiveSection(
          "Workspaces",
          workspaces.archivedWorkspaces().length,
          <For
            each={workspaces.archivedWorkspaces()}
            keyed={(workspace) => workspace._id}
          >
            {(workspace) => (
              <article class="archive-row">
                <span>
                  <Icon name="folder" size={17} />
                </span>
                <div class="archive-row-main">
                  <strong>{workspace().name}</strong>
                  <span>Workspace and all contained data</span>
                </div>
                <div class="archive-actions">
                  <button
                    type="button"
                    onClick={() => workspaces.restoreWorkspace(workspace()._id)}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      openRemoval({
                        kind: "workspace",
                        id: workspace()._id,
                        name: workspace().name,
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              </article>
            )}
          </For>,
        )}
      </div>
      <Show when={removal()}>
        {(selected) => (
          <div class="confirm-layer" role="presentation">
            <section
              class="confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label={`Delete ${selected().name}`}
            >
              <h3>Permanently delete {selected().name}?</h3>
              <p>
                This permanently removes {affectedText()}. This cannot be
                undone. Type <code>{selected().name}</code> to continue.
              </p>
              <input
                value={confirmation()}
                aria-label="Type name to confirm"
                onInput={(event) => setConfirmation(event.currentTarget.value)}
              />
              <div class="confirm-actions">
                <button type="button" onClick={() => setRemoval(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  class="danger"
                  disabled={deleting() || confirmation() !== selected().name}
                  onClick={() => void confirmRemoval()}
                >
                  {deleting() ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </section>
          </div>
        )}
      </Show>
    </section>
  );
}
