import { For, Show, createSignal } from "solid-js";
import { Icon } from "../../Icon";
import Avatar from "../../Avatar";
import { useWorkspaces } from "./context";
import "./WorkspaceMenu.css";
import { StartupControl } from "./StartupControl";

export function WorkspaceMenu() {
  const model = useWorkspaces();
  const [open, setOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  const submitCreate = async (event: SubmitEvent) => {
    event.preventDefault();
    if (saving()) return;
    setSaving(true);
    try { if (await model.createWorkspace(nameDraft())) { setNameDraft(""); setCreating(false); } }
    finally { setSaving(false); }
  };

  const submitRename = async (event: SubmitEvent) => {
    event.preventDefault();
    const workspace = model.activeWorkspace();
    if (!workspace || saving()) return;
    setSaving(true);
    try { if (await model.renameWorkspace(workspace.id, nameDraft())) { setNameDraft(""); setRenaming(false); } }
    finally { setSaving(false); }
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
                  disabled={saving()}
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
                value={nameDraft()}
                disabled={saving()}
                onInput={(event) => setNameDraft(event.currentTarget.value)}
                maxlength="80"
                autofocus
                required
              />
              <button type="submit" disabled={saving()}>{saving() ? "Saving…" : "Create"}</button>
            </form>
          </Show>

          <Show when={renaming() && model.activeWorkspace()}>
            <form class="workspace-form" onSubmit={submitRename}>
              <input
                name="workspaceName"
                aria-label="New Workspace name"
                value={nameDraft()}
                disabled={saving()}
                onInput={(event) => setNameDraft(event.currentTarget.value)}
                maxlength="80"
                autofocus
                required
              />
              <button type="submit" disabled={saving()}>{saving() ? "Saving…" : "Save"}</button>
            </form>
          </Show>

          <StartupControl />
          <footer>
            <button
              type="button"
              disabled={saving()}
              onClick={() => { setNameDraft(""); setRenaming(false); setCreating((value) => !value); }}
            >
              <Icon name="plus" size={16} />
              New
            </button>
            <button
              type="button"
              disabled={saving()}
              onClick={() => { setNameDraft(model.activeWorkspace()?.name ?? ""); setCreating(false); setRenaming((value) => !value); }}
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
