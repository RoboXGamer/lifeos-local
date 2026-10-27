import {
  action,
  createContext,
  createOptimisticStore,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { nanoid } from "nanoid";
import type { Doc, Id } from "../../local/types";
import { api } from "../../local/api";
import { createMutation, createQuery, toError } from "../../local";

export interface WorkspaceSummary {
  id: Id<"workspaces">;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface WorkspaceState {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: Id<"workspaces"> | null;
}

interface WorkspaceModel {
  state: WorkspaceState;
  archivedWorkspaces: Accessor<Doc<"workspaces">[]>;
  activeWorkspace: Accessor<WorkspaceSummary | undefined>;
  error: Accessor<string | null>;
  clearError: () => void;
  createWorkspace: (name: string) => void;
  renameWorkspace: (workspaceId: Id<"workspaces">, name: string) => void;
  selectWorkspace: (workspaceId: Id<"workspaces">) => void;
  archiveWorkspace: (workspaceId: Id<"workspaces">) => void;
  restoreWorkspace: (workspaceId: Id<"workspaces">) => void;
  deleteWorkspace: (
    workspaceId: Id<"workspaces">,
    confirmation: string,
  ) => void;
}

const emptyState: WorkspaceState = {
  workspaces: [],
  activeWorkspaceId: null,
};

const WorkspaceContext = createContext<WorkspaceModel>();

export function WorkspaceProvider(props: ParentProps) {
  const source = createQuery(
    api.workspaces.list,
    {},
    { initialValue: emptyState },
  );
  const [state, setState] = createOptimisticStore<WorkspaceState>(
    () => source() ?? emptyState,
    emptyState,
  );
  const archivedSource = createQuery(
    api.workspaces.listArchived,
    {},
    {
      initialValue: [],
    },
  );
  const [error, setError] = createSignal<string | null>(null);

  const createWorkspaceMutation = createMutation(api.workspaces.create);
  const renameWorkspaceMutation = createMutation(api.workspaces.rename);
  const selectWorkspaceMutation = createMutation(api.workspaces.select);
  const archiveWorkspaceMutation = createMutation(api.workspaces.setArchived);
  const deleteWorkspaceMutation = createMutation(api.workspaces.remove);

  const recordFailure = (reason: unknown) => setError(toError(reason).message);

  const createWorkspace = action(function* (name: string) {
    const cleanName = name.trim();
    if (!cleanName) return;
    setError(null);
    const now = Date.now();
    const tempId = `temp-${nanoid()}` as Id<"workspaces">;
    setState((draft) => {
      draft.workspaces.push({
        id: tempId,
        name: cleanName,
        createdAt: now,
        updatedAt: now,
      });
    });
    try {
      yield createWorkspaceMutation({ name: cleanName });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const renameWorkspace = action(function* (
    workspaceId: Id<"workspaces">,
    name: string,
  ) {
    const cleanName = name.trim();
    if (!cleanName) return;
    setError(null);
    const expectedUpdatedAt = state.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )?.updatedAt;
    if (expectedUpdatedAt === undefined) return;
    setState((draft) => {
      const workspace = draft.workspaces.find(
        (item) => item.id === workspaceId,
      );
      if (workspace) {
        workspace.name = cleanName;
        workspace.updatedAt = Date.now();
      }
    });
    try {
      yield renameWorkspaceMutation({
        workspaceId,
        name: cleanName,
        expectedUpdatedAt,
      });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const selectWorkspace = action(function* (workspaceId: Id<"workspaces">) {
    if (workspaceId === state.activeWorkspaceId) return;
    setError(null);
    setState((draft) => {
      draft.activeWorkspaceId = workspaceId;
    });
    try {
      yield selectWorkspaceMutation({ workspaceId });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const archiveWorkspace = action(function* (workspaceId: Id<"workspaces">) {
    setError(null);
    const fallback = state.workspaces.find((item) => item.id !== workspaceId);
    setState((draft) => {
      draft.workspaces = draft.workspaces.filter(
        (item) => item.id !== workspaceId,
      );
      if (draft.activeWorkspaceId === workspaceId) {
        draft.activeWorkspaceId = fallback?.id ?? null;
      }
    });
    try {
      yield archiveWorkspaceMutation({ workspaceId, archived: true });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const restoreWorkspace = action(function* (workspaceId: Id<"workspaces">) {
    setError(null);
    try {
      yield archiveWorkspaceMutation({ workspaceId, archived: false });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const deleteWorkspace = action(function* (
    workspaceId: Id<"workspaces">,
    confirmation: string,
  ) {
    setError(null);
    try {
      yield deleteWorkspaceMutation({ workspaceId, confirmation });
    } catch (reason) {
      recordFailure(reason);
    }
  });

  const model: WorkspaceModel = {
    state,
    archivedWorkspaces: () => archivedSource() ?? [],
    activeWorkspace: () =>
      state.workspaces.find((item) => item.id === state.activeWorkspaceId),
    error,
    clearError: () => setError(null),
    createWorkspace,
    renameWorkspace,
    selectWorkspace,
    archiveWorkspace,
    restoreWorkspace,
    deleteWorkspace,
  };

  return <WorkspaceContext value={model}>{props.children}</WorkspaceContext>;
}

export function useWorkspaces(): WorkspaceModel {
  return useContext(WorkspaceContext);
}
