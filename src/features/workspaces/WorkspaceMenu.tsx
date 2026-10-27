import { For, Show, createSignal } from "solid-js";
import { Icon } from "../../Icon";
import Avatar from "../../Avatar";
import { useWorkspaces } from "./context";
import "./WorkspaceMenu.css";

export function WorkspaceMenu() {
  const model = useWorkspaces();
  const [open, setOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);

  const submitCreate = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const name = new FormData(form).get("workspaceName")?.toString() ?? "";
    model.createWorkspace(name);
    form.reset();
    setCreating(false);
  };

  const submitRename = (event: SubmitEvent) => {
    event.preventDefault();
    const workspace = model.activeWorkspace();
    if (!workspace) return;
    const name =
      new FormData(event.currentTarget as HTMLFormElement)
        .get("workspaceName")
        ?.toString() ?? "";
    model.renameWorkspace(workspace.id, name);
    setRenaming(false);
  };

  return (
    <div class="workspace-menu">
      <button
        type="button"
        class="workspace-trigger"
        aria-label="Workspaces"
        aria-expanded={open() ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar
          size={40}
          fallback={(
            model.activeWorkspace()?.name ??
            "Life"
          )
            .slice(0, 2)
            .toUpperCase()}
        />
      </button>
      <Show when={open()}>
        <button
          class="workspace-menu-backdrop"
          aria-label="Close Workspace menu"
          onClick={() => setOpen(false)}
        />
        <section class="workspace-popover" aria-label="Workspaces">
          <header>
            <div>
              <span>Workspace</span>
              <strong>{model.activeWorkspace()?.name ?? "Life OS"}</strong>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={17} />
            </button>
          </header>

          <div class="workspace-list">
            <For each={model.state.workspaces}>
              {(workspace) => (
                <button
                  type="button"
                  class={{
                    selected: workspace.id === model.state.activeWorkspaceId,
                  }}
                  onClick={() => model.selectWorkspace(workspace.id)}
                >
                  <strong>{workspace.name}</strong>
                  <Show when={workspace.id === model.state.activeWorkspaceId}>
                    <small>Active</small>
                  </Show>
                </button>
              )}
            </For>
          </div>

          <Show when={model.error()}>
            {(message) => (
              <p class="workspace-error" role="alert">
                {message()}
              </p>
            )}
          </Show>

          <Show when={creating()}>
            <form class="workspace-form" onSubmit={submitCreate}>
              <input
                name="workspaceName"
                aria-label="Workspace name"
                placeholder="Workspace name"
                maxlength="80"
                autofocus
                required
              />
              <button type="submit">Create</button>
            </form>
          </Show>

          <Show when={renaming() && model.activeWorkspace()}>
            <form class="workspace-form" onSubmit={submitRename}>
              <input
                name="workspaceName"
                aria-label="New Workspace name"
                value={model.activeWorkspace()?.name}
                maxlength="80"
                autofocus
                required
              />
              <button type="submit">Save</button>
            </form>
          </Show>

          <footer>
            <button
              type="button"
              onClick={() => setCreating((value) => !value)}
            >
              <Icon name="plus" size={16} />
              New
            </button>
            <button
              type="button"
              onClick={() => setRenaming((value) => !value)}
            >
              <Icon name="edit" size={16} />
              Rename
            </button>
            <button
              type="button"
              class="danger"
              disabled={model.state.workspaces.length <= 1}
              onClick={() => {
                const workspace = model.activeWorkspace();
                if (workspace) model.archiveWorkspace(workspace.id);
              }}
            >
              <Icon name="archive" size={16} />
              Archive
            </button>
          </footer>
        </section>
      </Show>
    </div>
  );
}
