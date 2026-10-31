import { createOptimisticStore, For, Show } from "solid-js";
import { api } from "../local/api";
import type { Id } from "../local/types";
import { createQuery } from "../local";
import { Icon } from "../Icon";
import { ItemTableHeader, ItemTableRow } from "../features/items/ItemTable";
import { localDateKey } from "../features/items/dates";
import { useItems, type ItemView } from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import { useWorkspaces } from "../features/workspaces/context";
import "./Retrieval.css";
import { TodayAttention } from "../features/attention/TodayAttention";
import { HabitsToday } from "../features/attention/HabitsToday";
import "./TodayLayout.css";

export default function Today() {
  const workspaces = useWorkspaces();
  const items = useItems();
  const panel = useItemPanelRoute();
  const today = localDateKey();
  const source = createQuery(
    api.items.listToday,
    () => {
      const workspaceId = workspaces.state.activeWorkspaceId;
      return workspaceId ? { workspaceId, date: today } : "skip";
    },
    { initialValue: [] },
  );
  const [rows, setRows] = createOptimisticStore<ItemView[]>(
    () => source() ?? [],
    [],
    { key: "_id" },
  );
  const openItems = () => rows.filter((item) => item.status !== "Done");
  const completedTasks = () =>
    rows.filter((item) => item.type === "Task" && item.status === "Done");
  const tasks = () => rows.filter((item) => item.type === "Task");

  const toggle = async (itemId: Id<"items">, done: boolean) => {
    setRows((draft) => {
      const item = draft.find((entry) => entry._id === itemId);
      if (item) item.status = done ? "Done" : "Todo";
    });
    await items.setTaskDone(itemId, done);
  };

  return (
    <section class="retrieval-page today-page">
      <header class="retrieval-header">
        <div><h2>Today</h2><p class="today-date">{new Date(`${today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p></div>
        <button
          type="button"
          class="primary-action"
          onClick={() => panel.createItem({ date: today })}
        >
          <Icon name="plus" size={17} />
          Add for today
        </button>
      </header>
      <div class="today-layout"><div class="today-work"><div class="today-work-heading"><h3>My day</h3><span>{rows.length} {rows.length === 1 ? "item" : "items"}</span></div>
      <Show
        when={rows.length > 0}
        fallback={
          <div class="retrieval-empty">
            <span>
              <Icon name="checkSquare" size={25} />
            </span>
            <h3>Your day is clear</h3>
            <p>Items dated today will gather here automatically.</p>
          </div>
        }
      >
        <div class="retrieval-scroll">
          <Show when={tasks().length > 0}>
            <section class="today-progress">
              <div>
                <strong>
                  {completedTasks().length} of {tasks().length}
                </strong>
                <span>tasks completed today</span>
              </div>
              <i>
                <b
                  style={{
                    width: `${(completedTasks().length / tasks().length) * 100}%`,
                  }}
                />
              </i>
            </section>
          </Show>
          <div class="today-item-table item-table-shell">
            <ItemTableHeader />
            <div class="area-product-list">
              <For
                each={[...openItems(), ...completedTasks()]}
                keyed={(item) => item._id}
              >
                {(item) => (
                  <section class="area-family">
                    <ItemTableRow
                      item={item()}
                      onOpen={(id) => panel.openItem(id)}
                      onToggleTask={(id, done) => void toggle(id, done)}
                    />
                  </section>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
      </div><aside class="today-context" aria-label="Daily context"><HabitsToday /><details class="today-suggestions"><summary>Worth your attention</summary><TodayAttention /></details></aside></div>
    </section>
  );
}
