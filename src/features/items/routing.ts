import { useLocation, useNavigate } from "@solidjs/router";
import type { AppRouteSearch, ItemPanelMode } from "../../router";

function toQueryString(search: AppRouteSearch): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useItemPanelRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = () => location.query as AppRouteSearch;

  const update = (next: AppRouteSearch, replace = false) => {
    const merged = { ...next, q: search().q };
    navigate(`${location.pathname}${toQueryString(merged)}`, {
      replace,
      scroll: false,
    });
  };

  const openItem = (itemId: string, mode: ItemPanelMode = "view") =>
    update({ item: itemId, mode });
  const createItem = (options?: {
    area?: string;
    parent?: string;
    date?: string;
  }) =>
    update({
      mode: "create",
      area: options?.area,
      parent: options?.parent,
      date: options?.date,
    });
  const close = () => update({});

  return { search, update, openItem, createItem, close };
}
