import { Show } from "solid-js";
import type { Id } from "../../local/types";
import { Icon } from "../../Icon";
import type { ItemView } from "./context";
import {
  dueDateLabel,
  itemIcon,
  itemStatusLabel,
  priorityLabel,
} from "./types";
import "../../pages/AreaDetail.css";

export function ItemTableHeader() {
  return (
    <div class="area-table-head">
      <span>Title</span>
      <span class="area-col-type">Type</span>
      <span class="area-col-status">Status</span>
      <span class="area-col-priority">Priority</span>
      <span class="area-col-due">Due date</span>
      <span class="area-col-tags">Tags</span>
    </div>
  );
}

export function ItemTableRow(props: {
  item: ItemView;
  childCount?: number;
  isChild?: boolean;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onOpen: (itemId: Id<"items">) => void;
  onToggleTask: (itemId: Id<"items">, done: boolean) => void;
}) {
  const status = () => itemStatusLabel(props.item);

  return (
    <div
      class={["area-table-row", { "is-child": !!props.isChild }]}
      role="button"
      tabindex={0}
      onClick={() => props.onOpen(props.item._id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(props.item._id);
        }
      }}
    >
      <div class="area-row-title">
        <Show when={props.isChild}>
          <span class="area-child-branch" aria-hidden="true" />
        </Show>
        <Show
          when={(props.childCount ?? 0) > 0}
          fallback={<span class="area-row-expand-spacer" />}
        >
          <span class="area-row-family">
            <button
              class="family-toggle"
              type="button"
              aria-label={`Toggle children for ${props.item.title}`}
              aria-expanded={props.expanded ? "true" : "false"}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleExpanded?.();
              }}
            >
              <Icon
                name={props.expanded ? "chevronDown" : "chevronRight"}
                size={13}
              />
            </button>
            <small>{props.childCount}</small>
          </span>
        </Show>
        <Show
          when={props.item.type === "Task"}
          fallback={
            <span class="area-row-icon">
              <Icon name={itemIcon(props.item.type)} size={14} />
            </span>
          }
        >
          <button
            type="button"
            class={[
              "area-row-check",
              { checked: props.item.status === "Done" },
            ]}
            aria-label={
              props.item.status === "Done"
                ? "Mark task incomplete"
                : "Complete task"
            }
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleTask(props.item._id, props.item.status !== "Done");
            }}
          >
            <Show when={props.item.status === "Done"}>✓</Show>
          </button>
        </Show>
        <span class="area-row-title-copy">
          <strong class={{ completed: props.item.status === "Done" }}>
            {props.item.title}
          </strong>
          <span class="area-row-mobile-meta">
            {props.item.type ?? "Item"}
            <Show when={dueDateLabel(props.item.dueDate)}>
              {(label) => <> · {label()}</>}
            </Show>
          </span>
        </span>
      </div>
      <span class="area-col-type area-type-badge">
        {props.item.type ?? "Item"}
      </span>
      <span class="area-col-status">
        <Show when={status()} fallback={<span class="area-muted">—</span>}>
          {(label) => <span class="area-status-badge">{label()}</span>}
        </Show>
      </span>
      <span
        class={[
          "area-col-priority area-priority-pill",
          priorityLabel(props.item.priority)
            ? `priority-${priorityLabel(props.item.priority)?.toLowerCase()}`
            : "priority-none",
        ]}
      >
        {priorityLabel(props.item.priority) ?? "—"}
      </span>
      <span class="area-col-due area-date-cell">
        {dueDateLabel(props.item.dueDate) ?? "—"}
      </span>
      <span class="area-col-tags area-row-tags">
        <Show
          when={props.item.tags.length > 0}
          fallback={<span class="area-muted">—</span>}
        >
          <span>{props.item.tags[0]}</span>
          <Show when={props.item.tags.length > 1}>
            <small>+{props.item.tags.length - 1}</small>
          </Show>
        </Show>
      </span>
    </div>
  );
}
