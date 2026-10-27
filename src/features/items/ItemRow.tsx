import { For, Show } from "solid-js";
import type { Id } from "../../local/types";
import { Icon } from "../../Icon";
import type { ItemView } from "./context";
import {
  dueDateLabel,
  itemIcon,
  itemStatusLabel,
  priorityLabel,
} from "./types";
import "./ItemRow.css";

export function ItemRow(props: {
  item: ItemView;
  areaName?: string;
  childCount?: number;
  dateLabel?: string;
  compact?: boolean;
  onOpen: (itemId: Id<"items">) => void;
  onToggleTask?: (itemId: Id<"items">, done: boolean) => void;
}) {
  const item = () => props.item;
  return (
    <article
      class={[
        "product-item-row",
        { done: item().status === "Done", compact: !!props.compact },
      ]}
    >
      <Show
        when={item().type === "Task" && props.onToggleTask}
        fallback={
          <span class="product-item-icon">
            <Icon name={itemIcon(item().type)} size={18} />
          </span>
        }
      >
        <button
          type="button"
          class="product-item-check"
          aria-label={`${item().status === "Done" ? "Reopen" : "Complete"} ${item().title}`}
          onClick={() =>
            props.onToggleTask?.(item()._id, item().status !== "Done")
          }
        >
          <Icon name="checkSquare" size={18} />
        </button>
      </Show>
      <button
        type="button"
        class="product-item-copy"
        onClick={() => props.onOpen(item()._id)}
      >
        <strong>{item().title}</strong>
        <span>
          <em>{item().type ?? "Unsorted"}</em>
          <Show when={props.areaName}> · {props.areaName}</Show>
          <Show when={dueDateLabel(item().dueDate)}>
            {(date) => <> · {date()}</>}
          </Show>
        </span>
      </button>
      <div class="product-item-tags">
        <For each={item().tags.slice(0, 2)}>{(tag) => <span>#{tag}</span>}</For>
      </div>
      <Show when={item().priority}>
        {(priority) => (
          <span class={`product-priority p${priority()}`}>
            {priorityLabel(priority())}
          </span>
        )}
      </Show>
      <Show when={item().type === "Task" && item().status}>
        {(status) => (
          <span
            class={`product-status status-${status().toLowerCase().replace(" ", "-")}`}
          >
            {status()}
          </span>
        )}
      </Show>
      <Show when={item().type === "Expense" || item().type === "Income"}>
        <span
          class={[
            "product-financial-state",
            {
              realized:
                item().financialState === "Spent" ||
                item().financialState === "Received",
            },
          ]}
        >
          {itemStatusLabel(item())}
        </span>
      </Show>
      <Show when={item().amount !== undefined}>
        <span class="product-amount">
          {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(
            item().amount ?? 0,
          )}
        </span>
      </Show>
      <Show when={props.childCount}>
        <span class="product-child-count">{props.childCount} child</span>
      </Show>
      <Show when={props.dateLabel}>
        <time>{props.dateLabel}</time>
      </Show>
      <button
        type="button"
        class="product-item-open"
        aria-label={`Open ${item().title}`}
        onClick={() => props.onOpen(item()._id)}
      >
        <Icon name="chevronRight" size={16} />
      </button>
    </article>
  );
}
