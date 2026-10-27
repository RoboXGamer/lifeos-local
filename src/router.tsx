import { createRouter, defineRoutes, useNavigate } from "@solidjs/router";
import { onSettled } from "solid-js";
import App from "./App";
import AreaCalendar from "./pages/AreaCalendar";
import AreaDetail from "./pages/AreaDetail";
import Areas from "./pages/Areas";
import Archive from "./pages/Archive";
import { NotFoundPage } from "./pages/Placeholder";
import Search from "./pages/Search";
import Tags from "./pages/Tags";
import Today from "./pages/Today";
import Upcoming from "./pages/Upcoming";

export type ItemPanelMode = "view" | "edit" | "create" | "archived";

export interface AppRouteSearch {
  item?: string;
  mode?: ItemPanelMode;
  parent?: string;
  area?: string;
  date?: string;
  q?: string;
}

function Home() {
  const navigate = useNavigate();
  onSettled(() => navigate("/app/areas", { replace: true }));
  return null;
}

const routes = defineRoutes([
  { path: "/", component: Home },
  {
    path: "/app",
    component: App,
    children: [
      { path: "/", component: Home },
      { path: "/areas", component: Areas },
      { path: "/areas/:areaId", component: AreaDetail },
      { path: "/areas/:areaId/calendar", component: AreaCalendar },
      { path: "/today", component: Today },
      { path: "/upcoming", component: Upcoming },
      { path: "/tags", component: Tags },
      { path: "/archive", component: Archive },
      { path: "/search", component: Search },
    ],
  },
  { path: "*404", component: NotFoundPage },
]);

export const Router = createRouter({ routes });
