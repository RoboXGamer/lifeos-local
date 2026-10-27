import type { IconName } from "../../Icon";
import type { ItemPriority, ItemType, ItemView } from "./context";

export const itemTypes: ItemType[] = [
  "Task",
  "Note",
  "Event",
  "Expense",
  "Income",
];

export function itemIcon(type: ItemType | undefined): IconName {
  if (type === "Task") return "checkSquare";
  if (type === "Event") return "calendar";
  if (type === "Expense") return "expense";
  if (type === "Income") return "payment";
  if (type === "Note") return "description";
  return "inbox";
}

export function priorityLabel(
  priority: ItemPriority | undefined,
): "High" | "Medium" | "Low" | null {
  if (priority === 1) return "High";
  if (priority === 2) return "Medium";
  if (priority === 3) return "Low";
  return null;
}

export function itemStatusLabel(
  item: Pick<ItemView, "type" | "status" | "financialState">,
): string | null {
  if (item.type === "Task") return item.status ?? "Todo";
  if (item.type === "Expense") return item.financialState ?? "Planned";
  if (item.type === "Income") return item.financialState ?? "Expected";
  return null;
}

export function dueDateLabel(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}
