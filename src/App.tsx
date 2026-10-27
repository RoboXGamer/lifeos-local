import { createEffect, createSignal, For, onSettled, Show, type ParentProps } from "solid-js";
import "./App.css";
import { Icon } from "./Icon";
import { useLocation } from "@solidjs/router";
import { WorkspaceProvider } from "./features/workspaces/context";
import { WorkspaceMenu } from "./features/workspaces/WorkspaceMenu";
import { ItemProvider } from "./features/items/context";
import { InboxPanel } from "./features/items/InboxPanel";
import { ItemInspector } from "./features/items/ItemInspector";
import { SearchPanel } from "./features/items/SearchPanel";
import { useItemPanelRoute } from "./features/items/routing";
import type { RouteSectionProps } from "@solidjs/router";

const navItems = [
  { id: "areas", label: "Areas", icon: "grid" },
  { id: "today", label: "Today", icon: "checkSquare" },
  { id: "upcoming", label: "Upcoming", icon: "calendar" },
  { id: "tags", label: "Tags", icon: "tag" },
  { id: "archive", label: "Archive", icon: "archive" },
] as const;

function App(props: RouteSectionProps) {
  return (
    <WorkspaceProvider>
      <ItemProvider>
        <AppShell>{props.children}</AppShell>
      </ItemProvider>
    </WorkspaceProvider>
  );
}

function AppShell(props: ParentProps) {
  const desktopMedia = window.matchMedia("(min-width: 681px)");
  const [desktopShell, setDesktopShell] = createSignal(desktopMedia.matches);
  const desktopInboxOpen =
    desktopMedia.matches &&
    localStorage.getItem("life-os-inbox-collapsed") !== "true";
  const [inboxOpen, toggleInbox] = createSignal(desktopInboxOpen);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const location = useLocation();
  const itemPanel = useItemPanelRoute();
  const inspectorOpen = () => !!location.query.mode;
  const navActive = (id: (typeof navItems)[number]["id"]) =>
    id === "areas"
      ? location.pathname.startsWith("/app/areas")
      : location.pathname === `/app/${id}`;
  const closeInbox = (returnFocus = true) => {
    toggleInbox(false);
    if (returnFocus) {
      queueMicrotask(() =>
        document
          .querySelector<HTMLButtonElement>('button[aria-label="Inbox"]')
          ?.focus(),
      );
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    queueMicrotask(() =>
      document.querySelector<HTMLButtonElement>(".global-search-nav")?.focus(),
    );
  };
  const openSearch = () => {
    if (window.matchMedia("(max-width: 680px)").matches) closeInbox(false);
    setSearchOpen(true);
    queueMicrotask(() =>
      document.querySelector<HTMLInputElement>("#global-search-input")?.focus(),
    );
  };
  const toggleInboxPanel = () => {
    const open = !inboxOpen();
    if (
      open &&
      inspectorOpen() &&
      window.matchMedia("(max-width: 680px)").matches
    ) {
      itemPanel.close();
    }
    toggleInbox(open);
  };
  const closeInboxForNavigation = () => {
    if (!desktopShell()) closeInbox(false);
  };

  createEffect(
    () => [inboxOpen(), desktopShell()] as const,
    ([open, desktop]) => {
      if (desktop) {
        localStorage.setItem("life-os-inbox-collapsed", String(!open));
      }
      if (open) {
        queueMicrotask(() =>
          document.querySelector<HTMLInputElement>("#quick-capture")?.focus(),
        );
      }
    },
  );

  onSettled(() => {
    const openInbox = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
        event.preventDefault();
        if (!inboxOpen()) toggleInboxPanel();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape" && searchOpen()) closeSearch();
    };
    window.addEventListener("keydown", openInbox);
    const updateShellMode = (event: MediaQueryListEvent) =>
      setDesktopShell(event.matches);
    desktopMedia.addEventListener("change", updateShellMode);
    return () => {
      window.removeEventListener("keydown", openInbox);
      desktopMedia.removeEventListener("change", updateShellMode);
    };
  });

  return (
    <>
      <div
        id="app"
        class={{
          "inbox-open": inboxOpen(),
          "inspector-open": inspectorOpen(),
        }}
      >
        <aside class="sidebar">
          <span>{/* {sidebarW()} x {sidebarH()} */}</span>
          <nav class="nav-items">
            <button
              class={["nav-button", { active: inboxOpen() }]}
              aria-label="Inbox"
              title="Inbox"
              onClick={toggleInboxPanel}
            >
              <Icon name="inbox" size={22} />
            </button>
            <hr class="nav-sep" />
            <For each={navItems}>
              {(item) => (
                <a
                  class={[`nav-button${navActive(item.id) ? " active" : ""}`]}
                  aria-label={item.label}
                  title={item.label}
                  href={`/app/${item.id}`}
                  onClick={closeInboxForNavigation}
                >
                  <Icon name={item.icon} size={22} />
                </a>
              )}
            </For>
          </nav>
          <WorkspaceMenu />
        </aside>
        <div class={["inbox-host", { open: inboxOpen() }]}>
          <InboxPanel
            open={inboxOpen()}
            docked={desktopShell()}
            onClose={closeInbox}
          />
        </div>
        <main class="main">{props.children}</main>
        <ItemInspector docked={desktopShell()} />
        <div id="area-inspector-host" class="area-inspector-host" />
        <Show when={searchOpen()}>
          <div class="search-host open" onClick={closeSearch}>
            <SearchPanel onClose={closeSearch} />
          </div>
        </Show>
      </div>
    </>
  );
}

export default App;
