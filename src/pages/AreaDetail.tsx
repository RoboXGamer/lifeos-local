import { createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import type { Id } from "../local/types";
import { api } from "../local/api";
import { Icon, type IconName } from "../Icon";
import { createMutation, toError } from "../local";
import { useItems, type ItemType } from "../features/items/context";
import { ItemTableHeader, ItemTableRow } from "../features/items/ItemTable";
import { useItemPanelRoute } from "../features/items/routing";
import { AreaEditor, type AreaInput } from "./Areas";
import "./AreaDetail.css";

const types: Array<ItemType | "All"> = [
  "All",
  "Task",
  "Note",
  "Event",
  "Expense",
  "Income",
];

export default function AreaDetail() {
  const params = useParams<{ areaId: string }>();
  const items = useItems();
  const panel = useItemPanelRoute();
  const [search, setSearch] = createSignal("");
  const [type, setType] = createSignal<ItemType | "All">("All");
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [editingArea, setEditingArea] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const updateAreaMutation = createMutation(api.areas.update);
  const areaId = () => params.areaId as Id<"areas">;
  const area = () => items.areas().find((entry) => entry._id === areaId());
  const allAreaItems = () =>
    items.activeItems.filter((item) => item.areaId === areaId());
  const topLevelItems = () => {
    const query = search().trim().toLowerCase();
    return allAreaItems().filter((item) => {
      if (item.parentId !== null) return false;
      const family = [item, ...items.childrenOf(item._id)];
      const matchesType =
        type() === "All" || family.some((entry) => entry.type === type());
      const matchesSearch =
        !query ||
        family.some((entry) =>
          `${entry.title} ${entry.description ?? ""} ${entry.type ?? ""} ${entry.tags.join(" ")}`
            .toLowerCase()
            .includes(query),
        );
      return matchesType && matchesSearch;
    });
  };
  const toggleExpanded = (itemId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const open = (itemId: Id<"items">) => panel.openItem(itemId);
  const toggleTask = (itemId: Id<"items">, done: boolean) =>
    void items.setTaskDone(itemId, done);
  const saveArea = async (input: AreaInput) => {
    try {
      const currentArea = area();
      if (!currentArea) throw new Error("Area not found.");
      await updateAreaMutation({
        areaId: areaId(),
        expectedUpdatedAt: currentArea.updatedAt,
        ...input,
      });
      setEditingArea(false);
      setError(null);
    } catch (reason) {
      setError(toError(reason).message);
    }
  };
  const openAreaEditor = () => {
    panel.close();
    setEditingArea(true);
  };
  return (
    <section class="area-detail-page">
      <Show when={area()} fallback={<AreaUnavailable />}>
        {(currentArea) => (
          <>
            <header class="area-detail-topbar">
              <div class="area-breadcrumb">
                <a href="/app/areas">Areas</a>
                <Icon name="chevronRight" size={14} />
                <span>{currentArea().name}</span>
              </div>
              <div class="area-detail-actions">
                <button type="button" onClick={openAreaEditor}>
                  <Icon name="edit" size={17} /> Edit Area
                </button>
                <a href={`/app/areas/${areaId()}/calendar`}>
                  <Icon name="calendar" size={17} /> Calendar
                </a>
                <button
                  type="button"
                  class="primary-action"
                  onClick={() => panel.createItem({ area: areaId() })}
                >
                  <Icon name="plus" size={18} /> New Item
                </button>
              </div>
            </header>

            <Show when={error()}>
              {(message) => <p class="area-detail-error">{message()}</p>}
            </Show>

            <section
              class="area-summary"
              style={{ "--_area-color": currentArea().color }}
            >
              <div class="area-summary-art">
                <i />
                <b />
                <Icon
                  name={currentArea().icon as IconName}
                  size={46}
                  strokeWidth={1.35}
                />
              </div>
              <div class="area-summary-copy">
                <h1>{currentArea().name}</h1>
                <p>
                  {currentArea().description ||
                    "A focused home for everything connected to this part of life."}
                </p>
              </div>
              <div class="area-summary-total">
                <strong>{allAreaItems().length}</strong>
                <span>Total Items</span>
              </div>
            </section>

            <div class="area-toolbar">
              <label>
                <Icon name="search" size={17} />
                <input
                  value={search()}
                  placeholder="Search this Area…"
                  onInput={(event) => setSearch(event.currentTarget.value)}
                />
              </label>
              <div class="area-type-tabs">
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
              </div>
            </div>

            <ItemTableHeader />
            <Show
              when={topLevelItems().length > 0}
              fallback={
                <AreaEmpty
                  filtered={!!search() || type() !== "All"}
                  onCreate={() => panel.createItem({ area: areaId() })}
                />
              }
            >
              <div class="area-product-list">
                <For each={topLevelItems()} keyed={(item) => item._id}>
                  {(item) => {
                    const children = () => items.childrenOf(item()._id);
                    return (
                      <section class="area-family">
                        <ItemTableRow
                          item={item()}
                          childCount={children().length}
                          expanded={expanded().has(item()._id)}
                          onToggleExpanded={() => toggleExpanded(item()._id)}
                          onOpen={open}
                          onToggleTask={toggleTask}
                        />
                        <Show when={expanded().has(item()._id)}>
                          <div class="area-children">
                            <For each={children()} keyed={(child) => child._id}>
                              {(child) => (
                                <ItemTableRow
                                  item={child()}
                                  isChild
                                  onOpen={open}
                                  onToggleTask={toggleTask}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      </section>
                    );
                  }}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>
      <Show when={editingArea() && area()}>
        <AreaEditor
          area={area() ?? null}
          onClose={() => setEditingArea(false)}
          onSave={(input) => void saveArea(input)}
        />
      </Show>
    </section>
  );
}

function AreaEmpty(props: { filtered: boolean; onCreate: () => void }) {
  return (
    <div class="area-detail-empty">
      <span>
        <Icon name={props.filtered ? "search" : "list"} size={26} />
      </span>
      <h3>{props.filtered ? "No matching Items" : "Nothing here yet"}</h3>
      <p>
        {props.filtered
          ? "Try another search or Item type."
          : "Add the first Item you want to keep in view inside this Area."}
      </p>
      <Show when={!props.filtered}>
        <button onClick={props.onCreate}>Create an Item</button>
      </Show>
    </div>
  );
}

function AreaUnavailable() {
  return (
    <div class="area-detail-empty">
      <span>
        <Icon name="folder" size={26} />
      </span>
      <h3>Area unavailable</h3>
      <p>This Area may have been archived or removed.</p>
      <a href="/app/areas">Return to Areas</a>
    </div>
  );
}
