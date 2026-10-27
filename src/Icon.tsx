import type { IconName } from "./schemas.ts";
export type { IconName } from "./schemas.ts";

const iconNameMap: Record<string, string> = {
  inbox: "inbox",
  grid: "layout-grid",
  checkSquare: "square-check",
  calendar: "calendar",
  search: "search",
  tag: "tag",
  archive: "archive",
  settings: "settings",
  chart: "chart-bar",
  edit: "pencil",
  graduation: "graduation-cap",
  cart: "shopping-cart",
  bulb: "lightbulb",
  monitor: "monitor",
  book: "book",
  dumbbell: "dumbbell",
  plane: "plane",
  briefcase: "briefcase",
  folder: "folder",
  user: "user",
  heart: "heart",
  heartPulse: "heart-pulse",
  leaf: "leaf",
  mountain: "mountain",
  filter: "list-filter",
  share: "share",
  users: "users",
  star: "star",
  flag: "flag",
  clock: "clock",
  chevronDown: "chevron-down",
  chevronRight: "chevron-right",
  trash: "trash",
  currency: "currency",
  expense: "trending-down",
  payment: "banknote",
  description: "file-text",
  more: "ellipsis",
  list: "list",
  plus: "plus",
  command: "command",
  sparkle: "sparkle",
  close: "x",
};

export function Icon(props: {
  name: IconName;
  size?: number;
  class?: string;
  strokeWidth?: number;
}) {
  const s = () => props.size ?? 24;
  const sw = () => props.strokeWidth ?? 2;
  return (
    <svg
      width={s()}
      height={s()}
      fill="none"
      stroke="currentColor"
      stroke-width={sw()}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <use href={`/sprite.svg#${iconNameMap[props.name]}`} />
    </svg>
  );
}
