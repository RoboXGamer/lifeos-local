import {
  For,
  Show,
  createEffect,
  createSignal,
  onSettled,
  untrack,
  type Accessor,
  type Element,
} from "solid-js";
import type { Id } from "../../local/types";
import { Icon, type IconName } from "../../Icon";
import {
  useItems,
  type FinancialState,
  type ItemInput,
  type ItemPriority,
  type ItemStatus,
  type ItemType,
  type ItemView,
} from "./context";
import { useItemPanelRoute } from "./routing";
import { itemIcon, itemStatusLabel, itemTypes, priorityLabel } from "./types";
import "./ItemInspector.css";

const statuses: ItemStatus[] = ["Todo", "In Progress", "Done"];

export function ItemInspector(props: { docked: boolean }) {
  const items = useItems();
  const panel = useItemPanelRoute();
  const visible = () =>
    panel.search().mode === "create" || !!panel.search().item;
  const selected = () => items.itemById(panel.search().item);
  const mode = () =>
    panel.search().mode ??
    (selected()?.archived ? ("archived" as const) : ("view" as const));
  let returnFocus: HTMLElement | null = null;
  let wasVisible = false;

  createEffect(visible, (open) => {
    if (open && !wasVisible) {
      returnFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      queueMicrotask(() =>
        document
          .querySelector<HTMLButtonElement>(
            '.item-inspector button[aria-label="Close inspector"]',
          )
          ?.focus(),
      );
    } else if (!open && wasVisible) {
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
        returnFocus = null;
      });
    }
    wasVisible = open;
  });

  onSettled(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && visible()) panel.close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  return (
    <Show when={visible()}>
      <div
        class="item-inspector-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) panel.close();
        }}
      >
        <aside
          class="item-inspector"
          role={props.docked ? "complementary" : "dialog"}
          aria-modal={props.docked ? undefined : "true"}
          aria-label={mode() === "create" ? "Create Item" : "Item details"}
        >
          <Show
            when={mode() === "create"}
            fallback={
              <Show
                when={selected()}
                fallback={
                  <InspectorUnavailable
                    onClose={panel.close}
                    onClearError={items.clearError}
                    error={items.error}
                  />
                }
              >
                {(item) => (
                  <Show
                    when={mode() === "edit"}
                    fallback={
                      <ItemViewPanel
                        item={item}
                        onClose={panel.close}
                        onEdit={() =>
                          panel.update({ item: item()._id, mode: "edit" }, true)
                        }
                      />
                    }
                  >
                    <ItemForm
                      title="Edit Item"
                      item={item}
                      initialAreaId={() =>
                        panel.search().area ?? item().areaId ?? undefined
                      }
                      initialParentId={() => item().parentId ?? undefined}
                      initialDueDate={() => item().dueDate}
                      onClose={() =>
                        panel.update(
                          {
                            item: item()._id,
                            mode: item().archived ? "archived" : "view",
                          },
                          true,
                        )
                      }
                      onSave={(input) => items.updateItem(item()._id, input)}
                      onSaved={() => {
                        panel.update({ item: item()._id, mode: "view" }, true);
                      }}
                    />
                  </Show>
                )}
              </Show>
            }
          >
            <ItemForm
              title={
                panel.search().parent ? "Add child Item" : "Create an Item"
              }
              initialAreaId={() => panel.search().area}
              initialParentId={() => panel.search().parent}
              initialDueDate={() => panel.search().date}
              onClose={panel.close}
              onSave={items.createItem}
              onSaved={panel.close}
            />
          </Show>
        </aside>
      </div>
    </Show>
  );
}

function InspectorHeader(props: {
  eyebrow: string;
  title: string;
  icon: "plus" | "edit" | "inbox" | "archive";
  onClose: () => void;
}) {
  return (
    <header class="inspector-header">
      <div>
        <span>
          <Icon name={props.icon} size={18} />
        </span>
        <div>
          <small>{props.eyebrow}</small>
          <h2>{props.title}</h2>
        </div>
      </div>
      <button
        type="button"
        aria-label="Close inspector"
        onClick={props.onClose}
      >
        <Icon name="close" size={18} />
      </button>
    </header>
  );
}

function ItemProperty(props: {
  icon: IconName;
  label: string;
  strong?: boolean;
  children: Element;
}) {
  return (
    <div class="item-property-row">
      <span class="item-property-icon">
        <Icon name={props.icon} size={17} strokeWidth={1.8} />
      </span>
      <span class="item-property-label">{props.label}</span>
      <span class={`item-property-value${props.strong ? " strong" : ""}`}>
        {props.children}
      </span>
    </div>
  );
}

function ItemForm(props: {
  title: string;
  item?: Accessor<ItemView>;
  initialAreaId: () => string | undefined;
  initialParentId: () => string | undefined;
  initialDueDate: () => string | undefined;
  onClose: () => void;
  onSave: (input: ItemInput) => Promise<boolean>;
  onSaved: () => void;
}) {
  const items = useItems();
  const initial = untrack(() => props.item?.());
  const contextualParent = () =>
    items.itemById(props.initialParentId()) ?? undefined;
  const [title, setTitle] = createSignal(initial?.title ?? "");
  const [type, setType] = createSignal<ItemType | null>(initial?.type ?? null);
  const initialAreaId = untrack(
    () =>
      initial?.areaId ??
      contextualParent()?.areaId ??
      props.initialAreaId() ??
      "",
  );
  const initialParentId = untrack(
    () => initial?.parentId ?? props.initialParentId() ?? "",
  );
  const initialDueDate = untrack(
    () => initial?.dueDate ?? props.initialDueDate() ?? "",
  );
  const [areaId, setAreaId] = createSignal<string>(initialAreaId);
  const [status, setStatus] = createSignal<ItemStatus>(
    initial?.status ?? "Todo",
  );
  const [priority, setPriority] = createSignal<string>(
    initial?.priority?.toString() ?? "",
  );
  const [dueDate, setDueDate] = createSignal(initialDueDate);
  const [amount, setAmount] = createSignal(initial?.amount?.toString() ?? "");
  const [financialState, setFinancialState] = createSignal<FinancialState>(
    initial?.financialState ??
      (initial?.type === "Income" ? "Expected" : "Planned"),
  );
  const [description, setDescription] = createSignal(
    initial?.description ?? "",
  );
  const [parentId, setParentId] = createSignal(initialParentId);
  const [tags, setTags] = createSignal(initial?.tags.join(", ") ?? "");
  const [formError, setFormError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const hasChildren = () =>
    initial ? items.childrenOf(initial._id).length > 0 : false;
  const possibleParents = () =>
    items.activeItems.filter(
      (item) =>
        item.parentId === null &&
        item._id !== initial?._id &&
        item.areaId === (areaId() || null),
    );
  const moneyType = () => type() === "Expense" || type() === "Income";

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const cleanTitle = title().trim();
    if (!cleanTitle) {
      setFormError("Give this Item a title.");
      return;
    }
    if (areaId() && !type()) {
      setFormError("Choose an Item type before assigning an Area.");
      return;
    }
    setFormError(null);
    setSaving(true);
    const saved = await props.onSave({
      title: cleanTitle,
      areaId: (areaId() || null) as Id<"areas"> | null,
      type: type(),
      status: type() === "Task" ? status() : null,
      priority: priority() ? (Number(priority()) as ItemPriority) : null,
      dueDate: dueDate() || null,
      amount: moneyType() && amount() ? Number(amount()) : null,
      financialState: moneyType()
        ? type() === "Expense"
          ? financialState() === "Spent"
            ? "Spent"
            : "Planned"
          : financialState() === "Received"
            ? "Received"
            : "Expected"
        : null,
      description: description().trim() || null,
      parentId: (parentId() || null) as Id<"items"> | null,
      tags: tags()
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setSaving(false);
    if (saved) props.onSaved();
  };

  return (
    <>
      <InspectorHeader
        eyebrow={props.item ? "Item details" : "New capture"}
        title={props.title}
        icon={props.item ? "edit" : "plus"}
        onClose={props.onClose}
      />
      <form class="item-form" onSubmit={submit}>
        <Show when={formError() ?? items.error()}>
          {(message) => (
            <p class="item-panel-error" role="alert">
              {message()}
              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  items.clearError();
                }}
              >
                Dismiss
              </button>
            </p>
          )}
        </Show>

        <label class="item-title-field">
          <span>Title</span>
          <input
            value={title()}
            maxlength="200"
            placeholder="What needs your attention?"
            autofocus
            required
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
        </label>

        <div class="item-form-grid">
          <label>
            <span>Type</span>
            <select
              value={type() ?? ""}
              onInput={(event) => {
                const nextType = (event.currentTarget.value ||
                  null) as ItemType | null;
                setType(nextType);
                if (nextType === "Expense") setFinancialState("Planned");
                if (nextType === "Income") setFinancialState("Expected");
              }}
            >
              <option value="">Unsorted</option>
              <For each={itemTypes}>
                {(itemType) => <option value={itemType}>{itemType}</option>}
              </For>
            </select>
          </label>
          <label>
            <span>Area</span>
            <select
              value={areaId()}
              onInput={(event) => {
                const nextAreaId = event.currentTarget.value;
                setAreaId(nextAreaId);
                if (!nextAreaId) setParentId("");
              }}
            >
              <option value="">Inbox</option>
              <For each={items.areas()}>
                {(area) => <option value={area._id}>{area.name}</option>}
              </For>
            </select>
          </label>
        </div>
        <Show when={initial?.type && type() !== initial.type}>
          <p class="field-note">
            Changing type removes fields that the new type does not use when you
            save.
          </p>
        </Show>

        <Show when={type() === "Task"}>
          <div class="item-form-grid">
            <label>
              <span>Status</span>
              <select
                value={status()}
                onInput={(event) =>
                  setStatus(event.currentTarget.value as ItemStatus)
                }
              >
                <For each={statuses}>
                  {(itemStatus) => (
                    <option value={itemStatus}>{itemStatus}</option>
                  )}
                </For>
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select
                value={priority()}
                onInput={(event) => setPriority(event.currentTarget.value)}
              >
                <option value="">None</option>
                <option value="1">High</option>
                <option value="2">Medium</option>
                <option value="3">Low</option>
              </select>
            </label>
          </div>
        </Show>

        <Show when={moneyType()}>
          <div class="item-form-grid money-row">
            <label>
              <span>Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount()}
                placeholder="0.00"
                onInput={(event) => setAmount(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={financialState()}
                onInput={(event) =>
                  setFinancialState(event.currentTarget.value as FinancialState)
                }
              >
                <Show
                  when={type() === "Expense"}
                  fallback={
                    <>
                      <option value="Expected">Expected</option>
                      <option value="Received">Received</option>
                    </>
                  }
                >
                  <option value="Planned">Planned</option>
                  <option value="Spent">Spent</option>
                </Show>
              </select>
            </label>
          </div>
        </Show>

        <div class="item-form-grid">
          <label>
            <span>Due date</span>
            <input
              type="date"
              value={dueDate()}
              onInput={(event) => setDueDate(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Parent</span>
            <select
              value={parentId()}
              disabled={hasChildren() || !areaId()}
              onInput={(event) => {
                const nextParentId = event.currentTarget.value;
                setParentId(nextParentId);
                const parent = items.itemById(nextParentId);
                if (parent?.areaId) setAreaId(parent.areaId);
              }}
            >
              <option value="">None</option>
              <For each={possibleParents()}>
                {(parent) => <option value={parent._id}>{parent.title}</option>}
              </For>
            </select>
          </label>
        </div>
        <Show when={hasChildren()}>
          <p class="field-note">
            This Item is a parent, so it cannot be nested under another Item.
          </p>
        </Show>

        <label>
          <span>Tags</span>
          <input
            class="item-tags-input"
            value={tags()}
            list="life-os-tags"
            placeholder="urgent, waiting, reference"
            onInput={(event) => setTags(event.currentTarget.value)}
          />
          <datalist id="life-os-tags">
            <For each={items.tags()}>
              {(tag) => <option value={tag.name} />}
            </For>
          </datalist>
          <small>Separate tags with commas.</small>
        </label>

        <label>
          <span>Description</span>
          <textarea
            rows="5"
            maxlength="5000"
            placeholder="Add context, notes, or the next useful detail."
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
          />
        </label>

        <footer>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="primary-action" disabled={saving()}>
            {saving() ? "Saving…" : props.item ? "Save changes" : "Create Item"}
          </button>
        </footer>
      </form>
    </>
  );
}

function ItemViewPanel(props: {
  item: Accessor<ItemView>;
  onClose: () => void;
  onEdit: () => void;
}) {
  const items = useItems();
  const panel = useItemPanelRoute();
  const item = props.item;
  const area = () => items.areas().find((entry) => entry._id === item().areaId);
  const children = () => {
    const source = item().archived ? items.archivedItems : items.activeItems;
    return source.filter((entry) => entry.parentId === item()._id);
  };

  return (
    <>
      <InspectorHeader
        eyebrow={item().archived ? "Archived Item" : "Item details"}
        title={item().type ?? "Inbox Item"}
        icon={item().archived ? "archive" : "inbox"}
        onClose={props.onClose}
      />
      <div class="item-view">
        <Show when={items.error()}>
          {(message) => (
            <p class="item-panel-error" role="alert">
              {message()}
              <button type="button" onClick={items.clearError}>
                Dismiss
              </button>
            </p>
          )}
        </Show>
        <div class="item-view-title">
          <h3>{item().title}</h3>
        </div>

        <div class="item-property-grid">
          <ItemProperty icon={itemIcon(item().type)} label="Type">
            {item().type ?? "Unsorted"}
          </ItemProperty>
          <ItemProperty icon="folder" label="Area">
            {area()?.name ?? "Inbox"}
          </ItemProperty>
          <ItemProperty icon="list" label="Status">
            <span
              class={[
                "item-property-badge",
                `status-${itemStatusLabel(item())?.toLowerCase().replace(" ", "-") ?? "none"}`,
              ]}
            >
              {itemStatusLabel(item()) ?? "None"}
            </span>
          </ItemProperty>
          <ItemProperty icon="flag" label="Priority">
            <span
              class={[
                "item-property-badge",
                `priority-${priorityLabel(item().priority)?.toLowerCase() ?? "none"}`,
              ]}
            >
              {priorityLabel(item().priority) ?? "None"}
            </span>
          </ItemProperty>
          <Show when={item().dueDate}>
            {(date) => (
              <ItemProperty icon="calendar" label="Due Date" strong>
                {date()}
              </ItemProperty>
            )}
          </Show>
          <Show when={item().amount !== undefined}>
            <ItemProperty icon="currency" label="Amount" strong>
              {item().amount?.toLocaleString()}
            </ItemProperty>
          </Show>
        </div>

        <Show when={item().tags.length > 0}>
          <div class="item-tag-list">
            <For each={item().tags}>{(tag) => <span>#{tag}</span>}</For>
          </div>
        </Show>

        <Show when={item().description}>
          <section class="item-description">
            <span>Notes</span>
            <p>{item().description}</p>
          </section>
        </Show>

        <Show when={!item().archived}>
          <section class="item-children">
            <header>
              <div>
                <span>Related</span>
                <strong>Child Items</strong>
              </div>
              <button
                type="button"
                onClick={() =>
                  panel.createItem({
                    area: item().areaId ?? undefined,
                    parent: item()._id,
                  })
                }
              >
                <Icon name="plus" size={15} />
                Add
              </button>
            </header>
            <For
              each={children()}
              fallback={<p>No child Items yet.</p>}
              keyed={(child) => child._id}
            >
              {(child) => (
                <button
                  type="button"
                  class="child-item"
                  onClick={() => panel.openItem(child()._id)}
                >
                  <Icon name={itemIcon(child().type)} size={16} />
                  <span>{child().title}</span>
                  <Icon name="chevronRight" size={15} />
                </button>
              )}
            </For>
          </section>
        </Show>

        <footer class="item-view-actions">
          <Show when={!item().archived}>
            <button type="button" onClick={props.onEdit}>
              <Icon name="edit" size={16} />
              Edit
            </button>
          </Show>
          <button
            type="button"
            class={item().archived ? "restore-action" : "archive-action"}
            onClick={async () => {
              const archived = !item().archived;
              const saved = await items.setArchived(item()._id, archived);
              if (saved) {
                panel.update(
                  {
                    item: item()._id,
                    mode: archived ? "archived" : "view",
                  },
                  true,
                );
              }
            }}
          >
            <Icon name={item().archived ? "sparkle" : "archive"} size={16} />
            {item().archived ? "Restore" : "Archive"}
          </button>
        </footer>
      </div>
    </>
  );
}

function InspectorUnavailable(props: {
  error: Accessor<string | null>;
  onClearError: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <InspectorHeader
        eyebrow="Item unavailable"
        title="Nothing to inspect"
        icon="inbox"
        onClose={props.onClose}
      />
      <div class="inspector-unavailable">
        <span>
          <Icon name="inbox" size={28} />
        </span>
        <h3>This Item is no longer here.</h3>
        <p>
          {props.error() ?? "It may have moved, archived, or been removed."}
        </p>
        <button
          type="button"
          onClick={() => {
            props.onClearError();
            props.onClose();
          }}
        >
          Close inspector
        </button>
      </div>
    </>
  );
}
