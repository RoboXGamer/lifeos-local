import {
  Errored,
  For,
  Loading,
  Show,
  action,
  createOptimisticStore,
  createSignal,
  untrack,
} from "solid-js";
import { Portal } from "@solidjs/web";
import { nanoid } from "nanoid";
import type { Doc, Id } from "../local/types";
import { api } from "../local/api";
import { Icon, type IconName } from "../Icon";
import { createMutation, createQuery, toError } from "../local";
import { useWorkspaces } from "../features/workspaces/context";
import { useItems, type ItemInput } from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import "./Areas.css";

const areaIcons: IconName[] = [
  "folder",
  "graduation",
  "briefcase",
  "chart",
  "user",
  "heart",
  "heartPulse",
  "book",
  "monitor",
  "leaf",
];
const areaColors = [
  "#5a45e5",
  "#2f7dd3",
  "#13a06a",
  "#e29724",
  "#e0526d",
  "#8b55ce",
  "#168f99",
  "#d06736",
];

export interface AreaInput {
  name: string;
  description?: string;
  icon: string;
  color: string;
}

export default function Areas() {
  const workspaces = useWorkspaces();
  const items = useItems();
  const panel = useItemPanelRoute();
  const [view, setView] = createSignal<"grid" | "list">("grid");
  const [editor, setEditor] = createSignal<Doc<"areas"> | "new" | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const activeWorkspaceId = () => workspaces.state.activeWorkspaceId;
  const areaSource = createQuery(
    api.areas.list,
    () => {
      const workspaceId = activeWorkspaceId();
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const [areas, setAreas] = createOptimisticStore<Doc<"areas">[]>(
    () => areaSource() ?? [],
    [],
    { key: "_id" },
  );
  const createAreaMutation = createMutation(api.areas.create);
  const updateAreaMutation = createMutation(api.areas.update);
  const archiveAreaMutation = createMutation(api.areas.setArchived);

  const recordFailure = (reason: unknown) => setError(toError(reason).message);

  const createArea = action(function* (input: AreaInput) {
    const workspaceId = activeWorkspaceId();
    if (!workspaceId) return;
    setError(null);
    const now = Date.now();
    const tempId = `temp-${nanoid()}` as Id<"areas">;
    setAreas((draft) => {
      draft.push({
        _id: tempId,
        _creationTime: now,
        workspaceId,
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    });
    try {
      yield createAreaMutation({ workspaceId, ...input });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const updateArea = action(function* (areaId: Id<"areas">, input: AreaInput) {
    setError(null);
    const expectedUpdatedAt = areas.find(
      (area) => area._id === areaId,
    )?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    setAreas((draft) => {
      const area = draft.find((item) => item._id === areaId);
      if (area) Object.assign(area, input, { updatedAt: Date.now() });
    });
    try {
      yield updateAreaMutation({ areaId, expectedUpdatedAt, ...input });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const archiveArea = action(function* (areaId: Id<"areas">) {
    setError(null);
    setAreas((draft) => draft.filter((item) => item._id !== areaId));
    try {
      yield archiveAreaMutation({ areaId, archived: true });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const saveArea = (input: AreaInput) => {
    const current = editor();
    if (current === "new") createArea(input);
    else if (current) updateArea(current._id, input);
    queueMicrotask(() => setEditor(null));
  };

  const openEditor = (value: Doc<"areas"> | "new") => {
    panel.close();
    setEditor(value);
  };

  const moveInboxItem = (itemId: string, areaId: Id<"areas">) => {
    const item = items.itemById(itemId);
    if (!item || item.areaId !== null) return;
    if (!item.type) {
      panel.update({ item: item._id, mode: "edit", area: areaId });
      return;
    }
    const input: ItemInput = {
      title: item.title,
      areaId,
      type: item.type,
      status: item.status ?? null,
      priority: item.priority ?? null,
      dueDate: item.dueDate ?? null,
      amount: item.amount ?? null,
      financialState: item.financialState ?? null,
      description: item.description ?? null,
      parentId: item.parentId,
      tags: item.tags,
    };
    void items.updateItem(item._id, input);
  };

  return (
    <section class="areas-page">
      <header class="areas-header">
        <h2>Areas</h2>
        <div class="areas-header-actions">
          <div class="area-view-toggle" role="group" aria-label="Area view">
            <button
              type="button"
              class={{ active: view() === "grid" }}
              aria-label="Grid view"
              title="Grid view"
              onClick={() => setView("grid")}
            >
              <Icon name="grid" size={16} />
            </button>
            <button
              type="button"
              class={{ active: view() === "list" }}
              aria-label="List view"
              title="List view"
              onClick={() => setView("list")}
            >
              <Icon name="list" size={16} />
            </button>
          </div>
          <button
            type="button"
            class="primary-action"
            onClick={() => openEditor("new")}
          >
            <Icon name="plus" size={18} />
            New Area
          </button>
        </div>
      </header>

      <Show when={error()}>
        {(message) => (
          <p class="areas-error" role="alert">
            {message()}
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        )}
      </Show>

      <Errored
        fallback={(reason) => <p class="areas-error">{String(reason)}</p>}
      >
        <Loading fallback={<AreasSkeleton />}>
          <Show
            when={areas.length > 0}
            fallback={
              <div class="areas-empty">
                <span>
                  <Icon name="grid" size={27} />
                </span>
                <h3>Create your first Area</h3>
                <p>
                  Start with one part of life you want to protect from drift.
                </p>
                <button type="button" onClick={() => openEditor("new")}>
                  Create an Area
                </button>
              </div>
            }
          >
            <div class={["areas-grid", `view-${view()}`]}>
              <For each={areas} keyed={(area) => area._id}>
                {(area) => (
                  <article
                    class="area-item"
                    style={{ "--_deco-color": area().color }}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer?.types.includes(
                          "application/x-lifeos-item",
                        )
                      ) {
                        event.preventDefault();
                        if (event.dataTransfer)
                          event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const itemId = event.dataTransfer?.getData(
                        "application/x-lifeos-item",
                      );
                      if (itemId) moveInboxItem(itemId, area()._id);
                    }}
                  >
                    <a
                      class="area-card-link"
                      href={`/app/areas/${area()._id}`}
                      aria-label={`Open ${area().name}`}
                    />
                    <div class="deco">
                      <div class="deco-blobs">
                        <span class="shape shape-a" />
                        <span class="shape shape-b" />
                      </div>
                      <Icon
                        name={area().icon as IconName}
                        size={40}
                        strokeWidth={1.3}
                      />
                    </div>
                    <div class="area-title">
                      <Icon name={area().icon as IconName} />
                      <h3>{area().name}</h3>
                      <div class="area-actions">
                        <button
                          type="button"
                          aria-label={`Edit ${area().name}`}
                          onClick={() => openEditor({ ...area() })}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${area().name}`}
                          onClick={() => archiveArea(area()._id)}
                        >
                          <Icon name="archive" size={16} />
                        </button>
                      </div>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </Loading>
      </Errored>

      <Show when={editor()} keyed>
        {(value) => (
          <AreaEditor
            area={value === "new" ? null : (value as Doc<"areas">)}
            onClose={() => setEditor(null)}
            onSave={saveArea}
          />
        )}
      </Show>
    </section>
  );
}

export function AreaEditor(props: {
  area: Doc<"areas"> | null;
  onClose: () => void;
  onSave: (input: AreaInput) => void;
}) {
  const mount = document.getElementById("area-inspector-host");
  const initialArea = untrack(() => props.area);
  const [icon, setIcon] = createSignal<IconName>(
    (initialArea?.icon as IconName) ?? "folder",
  );
  const [color, setColor] = createSignal(initialArea?.color ?? areaColors[0]);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    props.onSave({
      name: data.get("name")?.toString().trim() ?? "",
      description: data.get("description")?.toString().trim() || undefined,
      icon: data.get("icon")?.toString() ?? "folder",
      color: data.get("color")?.toString() ?? "#5a45e5",
    });
  };

  if (!mount) return null;

  return (
    <Portal mount={mount}>
      <div
        class="dialog-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <section class="area-dialog" role="dialog" aria-modal="true">
          <header>
            <div>
              <span>
                <Icon name={props.area ? "edit" : "plus"} size={18} />
              </span>
              <div>
                <h3>{props.area ? "Edit Area" : "Create an Area"}</h3>
                <p>Give this part of life a clear identity.</p>
              </div>
            </div>
            <button type="button" aria-label="Close" onClick={props.onClose}>
              <Icon name="close" size={18} />
            </button>
          </header>
          <form onSubmit={submit}>
            <label>
              <span>Name</span>
              <input
                name="name"
                value={props.area?.name ?? ""}
                maxlength="80"
                autofocus
                required
              />
            </label>
            <label>
              <span>Description</span>
              <textarea
                name="description"
                rows="3"
                maxlength="5000"
                placeholder="What belongs here?"
              >
                {props.area?.description ?? ""}
              </textarea>
            </label>
            <fieldset class="area-choice-field">
              <legend>Icon</legend>
              <input type="hidden" name="icon" value={icon()} />
              <div class="area-icon-grid">
                <For each={areaIcons}>
                  {(choice) => (
                    <button
                      type="button"
                      class={{ active: icon() === choice }}
                      aria-label={`Use ${choice} icon`}
                      onClick={() => setIcon(choice)}
                    >
                      <Icon name={choice} size={18} />
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
            <fieldset class="area-choice-field">
              <legend>Color</legend>
              <input type="hidden" name="color" value={color()} />
              <div class="area-color-grid">
                <For each={areaColors}>
                  {(choice) => (
                    <button
                      type="button"
                      class={{ active: color() === choice }}
                      aria-label={`Use color ${choice}`}
                      style={{ "--_choice": choice }}
                      onClick={() => setColor(choice)}
                    />
                  )}
                </For>
                <label class="custom-area-color">
                  <span>Custom</span>
                  <input
                    type="color"
                    value={color()}
                    onInput={(event) => setColor(event.currentTarget.value)}
                  />
                </label>
              </div>
            </fieldset>
            <footer>
              <button type="button" onClick={props.onClose}>
                Cancel
              </button>
              <button type="submit" class="primary-action">
                {props.area ? "Save changes" : "Create Area"}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </Portal>
  );
}

function AreasSkeleton() {
  return (
    <div class="areas-grid" aria-label="Loading Areas">
      <For each={[1, 2, 3]}>
        {() => <div class="area-item area-skeleton" />}
      </For>
    </div>
  );
}
