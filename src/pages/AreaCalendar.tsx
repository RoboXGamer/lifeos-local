import { createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { api } from "../local/api";
import type { Id } from "../local/types";
import { createQuery } from "../local";
import { Icon } from "../Icon";
import { ItemRow } from "../features/items/ItemRow";
import {
  compactDateLabel,
  localDateKey,
  monthRange,
} from "../features/items/dates";
import { useItems, type ItemView } from "../features/items/context";
import { useItemPanelRoute } from "../features/items/routing";
import { itemIcon } from "../features/items/types";
import "./AreaCalendar.css";

type CalendarView = "week" | "agenda" | "month";
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addDays = (date: Date, amount: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const startOfWeek = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

export default function AreaCalendar() {
  const params = useParams<{ areaId: string }>();
  const items = useItems();
  const panel = useItemPanelRoute();
  const areaId = () => params.areaId as Id<"areas">;
  const area = () => items.areas().find((entry) => entry._id === areaId());
  const [view, setView] = createSignal<CalendarView>("week");
  const [anchor, setAnchor] = createSignal(new Date());
  const [selectedDate, setSelectedDate] = createSignal(localDateKey());
  const range = () => {
    if (view() === "month") return monthRange(anchor());
    const start = startOfWeek(anchor());
    const end = addDays(start, view() === "agenda" ? 41 : 6);
    return { fromDate: localDateKey(start), toDate: localDateKey(end) };
  };
  const source = createQuery(
    api.items.listByArea,
    () => ({ areaId: areaId() }),
    { initialValue: [] },
  );
  const calendarItems = () => {
    const currentRange = range();
    const merged = new Map<Id<"items">, ItemView>();
    const include = (item: ItemView) => {
      if (
        item.areaId === areaId() &&
        item.dueDate &&
        item.dueDate >= currentRange.fromDate &&
        item.dueDate <= currentRange.toDate
      ) {
        merged.set(item._id, item);
      }
    };
    for (const item of source() ?? []) include(item);
    for (const item of items.activeItems) {
      include(item);
    }
    return [...merged.values()];
  };
  const weekDays = () =>
    Array.from({ length: 7 }, (_, index) =>
      addDays(startOfWeek(anchor()), index),
    );
  const itemsFor = (date: string) =>
    calendarItems().filter((item) => item.dueDate === date);
  const selectedItems = () => itemsFor(selectedDate());
  const overdue = () =>
    items.activeItems
      .filter(
        (item) =>
          item.areaId === areaId() &&
          item.type === "Task" &&
          item.status !== "Done" &&
          item.dueDate &&
          item.dueDate < localDateKey(),
      )
      .slice(0, 5);
  const rangeLabel = () => {
    if (view() === "month")
      return new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
      }).format(anchor());
    const dates = weekDays();
    const end = view() === "agenda" ? addDays(dates[0], 41) : dates[6];
    const format = (date: Date) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }).format(date);
    return `${format(dates[0])} – ${format(end)}, ${end.getFullYear()}`;
  };
  const move = (amount: number) => {
    const current = anchor();
    const next =
      view() === "month"
        ? new Date(current.getFullYear(), current.getMonth() + amount, 1)
        : addDays(current, amount * (view() === "agenda" ? 42 : 7));
    setAnchor(next);
    setSelectedDate(
      localDateKey(view() === "month" ? next : startOfWeek(next)),
    );
  };
  const goToday = () => {
    setAnchor(new Date());
    setSelectedDate(localDateKey());
  };
  const createOn = (date: string) => panel.createItem({ area: areaId(), date });
  const open = (itemId: Id<"items">) => panel.openItem(itemId);
  const toggle = (itemId: Id<"items">, done: boolean) =>
    void items.setTaskDone(itemId, done);

  return (
    <section class="area-calendar-page">
      <header class="calendar-product-header">
        <div class="area-breadcrumb">
          <a href="/app/areas">Areas</a>
          <Icon name="chevronRight" size={14} />
          <a href={`/app/areas/${areaId()}`}>
            {area()?.name ?? "Area"}
          </a>
          <Icon name="chevronRight" size={14} />
          <span>Calendar</span>
        </div>
        <button class="primary-action" onClick={() => createOn(selectedDate())}>
          <Icon name="plus" size={17} /> New Item
        </button>
      </header>

      <div class="calendar-toolbar">
        <div class="calendar-navigation">
          <button aria-label="Previous period" onClick={() => move(-1)}>
            <Icon name="chevronRight" size={16} />
          </button>
          <strong>{rangeLabel()}</strong>
          <button aria-label="Next period" onClick={() => move(1)}>
            <Icon name="chevronRight" size={16} />
          </button>
          <button onClick={goToday}>Today</button>
        </div>
        <div class="calendar-view-tabs">
          <For each={["week", "agenda", "month"] as CalendarView[]}>
            {(mode) => (
              <button
                class={{ active: view() === mode }}
                onClick={() => setView(mode)}
              >
                {mode}
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="calendar-stats">
        <Metric label="In range" value={calendarItems().length} />
        <Metric
          label="Tasks"
          value={calendarItems().filter((item) => item.type === "Task").length}
        />
        <Metric
          label="Events"
          value={calendarItems().filter((item) => item.type === "Event").length}
        />
        <Metric
          label="Finances"
          value={
            calendarItems().filter(
              (item) => item.type === "Expense" || item.type === "Income",
            ).length
          }
        />
      </div>

      <div class="calendar-product-layout">
        <main>
          <Show when={view() === "week"}>
            <WeekView
              days={weekDays()}
              itemsFor={itemsFor}
              selectedDate={selectedDate()}
              onSelect={setSelectedDate}
              onCreate={createOn}
              onOpen={open}
            />
          </Show>
          <Show when={view() === "agenda"}>
            <AgendaView
              items={calendarItems()}
              onOpen={open}
              onToggle={toggle}
            />
          </Show>
          <Show when={view() === "month"}>
            <MonthView
              anchor={anchor()}
              itemsFor={itemsFor}
              selectedDate={selectedDate()}
              onSelect={setSelectedDate}
            />
          </Show>
        </main>
        <aside class="calendar-day-panel">
          <header>
            <div>
              <span>Selected day</span>
              <h3>{compactDateLabel(selectedDate())}</h3>
            </div>
            <button onClick={() => createOn(selectedDate())}>
              <Icon name="plus" size={15} /> Add
            </button>
          </header>
          <div class="calendar-selected-list">
            <For
              each={selectedItems()}
              fallback={<p>No Items on this date.</p>}
              keyed={(item) => item._id}
            >
              {(item) => <MiniItem item={item()} onOpen={open} />}
            </For>
          </div>
          <Show when={overdue().length > 0}>
            <section class="calendar-overdue">
              <header>
                <span>Overdue</span>
                <strong>{overdue().length}</strong>
              </header>
              <For each={overdue()} keyed={(item) => item._id}>
                {(item) => <MiniItem item={item()} onOpen={open} />}
              </For>
            </section>
          </Show>
        </aside>
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: number }) {
  return (
    <div>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function WeekView(props: {
  days: Date[];
  itemsFor: (date: string) => ItemView[];
  selectedDate: string;
  onSelect: (date: string) => void;
  onCreate: (date: string) => void;
  onOpen: (id: Id<"items">) => void;
}) {
  return (
    <div class="week-calendar">
      <For each={props.days}>
        {(day, index) => {
          const key = localDateKey(day);
          return (
            <section
              class={{
                selected: props.selectedDate === key,
                today: localDateKey() === key,
              }}
              onClick={() => props.onSelect(key)}
            >
              <header>
                <span>{weekdays[index()]}</span>
                <strong>{day.getDate()}</strong>
              </header>
              <div>
                <For each={props.itemsFor(key)} keyed={(item) => item._id}>
                  {(item) => (
                    <button
                      class={`calendar-chip type-${item().type?.toLowerCase() ?? "item"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onOpen(item()._id);
                      }}
                    >
                      <Icon name={itemIcon(item().type)} size={14} />
                      <span>{item().title}</span>
                    </button>
                  )}
                </For>
              </div>
              <button
                class="calendar-add-day"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onCreate(key);
                }}
              >
                <Icon name="plus" size={13} /> Add item
              </button>
            </section>
          );
        }}
      </For>
    </div>
  );
}

function AgendaView(props: {
  items: ItemView[];
  onOpen: (id: Id<"items">) => void;
  onToggle: (id: Id<"items">, done: boolean) => void;
}) {
  const groups = () => {
    const map = new Map<string, ItemView[]>();
    for (const item of props.items)
      if (item.dueDate)
        map.set(item.dueDate, [...(map.get(item.dueDate) ?? []), item]);
    return [...map.entries()];
  };
  return (
    <div class="calendar-agenda">
      <For
        each={groups()}
        fallback={
          <p class="calendar-empty-copy">No dated Items in this range.</p>
        }
        keyed={(group) => group[0]}
      >
        {(group) => (
          <section>
            <header>
              <strong>{compactDateLabel(group()[0])}</strong>
              <span>{group()[1].length}</span>
            </header>
            <For each={group()[1]} keyed={(item) => item._id}>
              {(item) => (
                <ItemRow
                  item={item()}
                  compact
                  onOpen={props.onOpen}
                  onToggleTask={props.onToggle}
                />
              )}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}

function MonthView(props: {
  anchor: Date;
  itemsFor: (date: string) => ItemView[];
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const days = () => {
    const first = new Date(
      props.anchor.getFullYear(),
      props.anchor.getMonth(),
      1,
    );
    const offset = (first.getDay() + 6) % 7;
    const last = new Date(
      props.anchor.getFullYear(),
      props.anchor.getMonth() + 1,
      0,
    );
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from(
        { length: last.getDate() },
        (_, i) =>
          new Date(props.anchor.getFullYear(), props.anchor.getMonth(), i + 1),
      ),
    ];
  };
  return (
    <div class="month-product-calendar">
      <For each={weekdays}>{(day) => <span>{day}</span>}</For>
      <For each={days()}>
        {(day) => (
          <Show when={day} fallback={<i />}>
            {(date) => {
              const key = localDateKey(date());
              const dayItems = () => props.itemsFor(key);
              return (
                <button
                  class={{
                    selected: props.selectedDate === key,
                    today: localDateKey() === key,
                  }}
                  onClick={() => props.onSelect(key)}
                >
                  <strong>{date().getDate()}</strong>
                  <For each={dayItems().slice(0, 2)}>
                    {(item) => <small>{item.title}</small>}
                  </For>
                  <Show when={dayItems().length > 2}>
                    <em>+{dayItems().length - 2} more</em>
                  </Show>
                </button>
              );
            }}
          </Show>
        )}
      </For>
    </div>
  );
}

function MiniItem(props: {
  item: ItemView;
  onOpen: (id: Id<"items">) => void;
}) {
  return (
    <button
      class="calendar-mini-item"
      onClick={() => props.onOpen(props.item._id)}
    >
      <span>
        <Icon name={itemIcon(props.item.type)} size={15} />
      </span>
      <div>
        <strong>{props.item.title}</strong>
        <small>{props.item.type ?? "Unsorted"}</small>
      </div>
      <Icon name="chevronRight" size={14} />
    </button>
  );
}
