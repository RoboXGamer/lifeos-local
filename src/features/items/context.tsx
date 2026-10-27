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
import { api } from "../../local/api";
import type { Doc, Id } from "../../local/types";
import { createMutation, createQuery, toError } from "../../local";
import { useWorkspaces } from "../workspaces/context";

export type ItemType = "Task" | "Note" | "Event" | "Expense" | "Income";
export type ItemStatus = "Todo" | "In Progress" | "Done";
export type ItemPriority = 1 | 2 | 3;
export type FinancialState = "Planned" | "Spent" | "Expected" | "Received";
export type ItemView = Omit<Doc<"items">, "type" | "financialState"> & {
  type?: ItemType;
  financialState?: FinancialState;
  tags: string[];
};

export interface ItemInput {
  title: string;
  areaId: Id<"areas"> | null;
  type: ItemType | null;
  status: ItemStatus | null;
  priority: ItemPriority | null;
  dueDate: string | null;
  amount: number | null;
  financialState: FinancialState | null;
  description: string | null;
  parentId: Id<"items"> | null;
  tags: string[];
}

interface ProfileSummary {
  isAnonymous: boolean;
}

interface ItemModel {
  activeItems: readonly ItemView[];
  archivedItems: readonly ItemView[];
  areas: Accessor<Doc<"areas">[]>;
  tags: Accessor<Doc<"tags">[]>;
  profile: Accessor<ProfileSummary | undefined>;
  error: Accessor<string | null>;
  clearError: () => void;
  inboxItems: Accessor<ItemView[]>;
  itemById: (itemId: string | undefined) => ItemView | undefined;
  childrenOf: (itemId: Id<"items">) => ItemView[];
  quickCapture: (title: string) => Promise<boolean>;
  createItem: (input: ItemInput) => Promise<boolean>;
  updateItem: (itemId: Id<"items">, input: ItemInput) => Promise<boolean>;
  setTaskDone: (itemId: Id<"items">, done: boolean) => Promise<boolean>;
  setArchived: (itemId: Id<"items">, archived: boolean) => Promise<boolean>;
}

const ItemContext = createContext<ItemModel>();

function optimisticItem(
  workspaceId: Id<"workspaces">,
  input: ItemInput,
): ItemView {
  const now = Date.now();
  return {
    _id: `temp-${nanoid()}` as Id<"items">,
    _creationTime: now,
    workspaceId,
    title: input.title.trim(),
    areaId: input.areaId,
    type: input.type ?? undefined,
    status: input.type === "Task" ? (input.status ?? "Todo") : undefined,
    priority: input.priority ?? undefined,
    dueDate: input.dueDate || undefined,
    amount:
      input.type === "Expense" || input.type === "Income"
        ? (input.amount ?? undefined)
        : undefined,
    financialState:
      input.type === "Expense" || input.type === "Income"
        ? (input.financialState ??
          (input.type === "Expense" ? "Planned" : "Expected"))
        : undefined,
    description: input.description || undefined,
    parentId: input.parentId,
    archived: false,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
  };
}

export function ItemProvider(props: ParentProps) {
  const workspaces = useWorkspaces();
  const activeWorkspaceId = () => workspaces.state.activeWorkspaceId;
  const [error, setError] = createSignal<string | null>(null);

  const activeSource = createQuery(
    api.items.list,
    () => {
      const workspaceId = activeWorkspaceId();
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const archivedSource = createQuery(
    api.items.listArchived,
    () => {
      const workspaceId = activeWorkspaceId();
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const areaSource = createQuery(
    api.areas.list,
    () => {
      const workspaceId = activeWorkspaceId();
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const tagSource = createQuery(
    api.tags.list,
    () => {
      const workspaceId = activeWorkspaceId();
      return workspaceId ? { workspaceId } : "skip";
    },
    { initialValue: [] },
  );
  const profileSource = createQuery(api.profiles.current, {}, {});

  const [activeItems, setActiveItems] = createOptimisticStore<ItemView[]>(
    () => activeSource() ?? [],
    [],
    { key: "_id" },
  );
  const [archivedItems, setArchivedItems] = createOptimisticStore<ItemView[]>(
    () => archivedSource() ?? [],
    [],
    { key: "_id" },
  );

  const quickCaptureMutation = createMutation(api.items.quickCapture);
  const createItemMutation = createMutation(api.items.create);
  const updateItemMutation = createMutation(api.items.update);
  const setTaskDoneMutation = createMutation(api.items.setTaskDone);
  const setArchivedMutation = createMutation(api.items.setArchived);

  const recordFailure = (reason: unknown) => setError(toError(reason).message);

  const quickCapture = action(function* (title: string) {
    const workspaceId = activeWorkspaceId();
    const cleanTitle = title.trim();
    if (!workspaceId || !cleanTitle) return false;
    setError(null);
    setActiveItems((draft) => {
      draft.unshift(
        optimisticItem(workspaceId, {
          title: cleanTitle,
          areaId: null,
          type: null,
          status: null,
          priority: null,
          dueDate: null,
          amount: null,
          financialState: null,
          description: null,
          parentId: null,
          tags: [],
        }),
      );
    });
    try {
      yield quickCaptureMutation({ workspaceId, title: cleanTitle });
      return true;
    } catch (reason) {
      recordFailure(reason);
      return false;
    }
  });

  const createItem = action(function* (input: ItemInput) {
    const workspaceId = activeWorkspaceId();
    if (!workspaceId || !input.title.trim()) return false;
    setError(null);
    let optimistic = optimisticItem(workspaceId, input);
    if (input.parentId) {
      const parent = activeItems.find((item) => item._id === input.parentId);
      if (parent) optimistic = { ...optimistic, areaId: parent.areaId };
    }
    setActiveItems((draft) => {
      draft.unshift(optimistic);
    });
    try {
      yield createItemMutation({ workspaceId, ...input });
      return true;
    } catch (reason) {
      recordFailure(reason);
      return false;
    }
  });

  const updateItem = action(function* (itemId: Id<"items">, input: ItemInput) {
    setError(null);
    const expectedUpdatedAt = activeItems.find(
      (entry) => entry._id === itemId,
    )?.updatedAt;
    if (expectedUpdatedAt === undefined) return false;
    setActiveItems((draft) => {
      const item = draft.find((entry) => entry._id === itemId);
      if (!item) return;
      const oldAreaId = item.areaId;
      let areaId = input.areaId;
      let parentId = input.parentId;
      if (parentId) {
        const parent = draft.find((entry) => entry._id === parentId);
        if (parent) areaId = parent.areaId;
      } else if (item.parentId && areaId !== oldAreaId) {
        parentId = null;
      }
      Object.assign(item, {
        ...input,
        areaId,
        parentId,
        type: input.type ?? undefined,
        status: input.type === "Task" ? (input.status ?? "Todo") : undefined,
        priority: input.priority ?? undefined,
        dueDate: input.dueDate || undefined,
        amount:
          input.type === "Expense" || input.type === "Income"
            ? (input.amount ?? undefined)
            : undefined,
        financialState:
          input.type === "Expense" || input.type === "Income"
            ? (input.financialState ??
              (input.type === "Expense" ? "Planned" : "Expected"))
            : undefined,
        description: input.description || undefined,
        updatedAt: Date.now(),
      });
      if (!item.parentId && areaId !== oldAreaId) {
        for (const child of draft) {
          if (child.parentId === itemId) child.areaId = areaId;
        }
      }
    });
    try {
      yield updateItemMutation({ itemId, expectedUpdatedAt, ...input });
      return true;
    } catch (reason) {
      recordFailure(reason);
      return false;
    }
  });

  const setTaskDone = action(function* (itemId: Id<"items">, done: boolean) {
    setError(null);
    setActiveItems((draft) => {
      const item = draft.find((entry) => entry._id === itemId);
      if (item) {
        item.status = done ? "Done" : "Todo";
        item.updatedAt = Date.now();
      }
    });
    try {
      yield setTaskDoneMutation({ itemId, done });
      return true;
    } catch (reason) {
      recordFailure(reason);
      return false;
    }
  });

  const setArchived = action(function* (
    itemId: Id<"items">,
    archived: boolean,
  ) {
    setError(null);
    const source = archived ? activeItems : archivedItems;
    const targetIds = new Set<Id<"items">>();
    const selected = source.find((item) => item._id === itemId);
    if (archived && selected?.parentId) {
      targetIds.add(selected._id);
    } else {
      const rootId = selected?.parentId ?? selected?._id;
      if (rootId) {
        targetIds.add(rootId);
        for (const item of source) {
          if (item.parentId === rootId) targetIds.add(item._id);
        }
      }
    }
    const moved = source
      .filter((item) => targetIds.has(item._id))
      .map((item) => ({
        ...item,
        archived,
        updatedAt: Date.now(),
      }));
    if (archived) {
      setActiveItems((draft) =>
        draft.filter((item) => !targetIds.has(item._id)),
      );
      setArchivedItems((draft) => {
        draft.unshift(...moved);
      });
    } else {
      setArchivedItems((draft) =>
        draft.filter((item) => !targetIds.has(item._id)),
      );
      setActiveItems((draft) => {
        draft.unshift(...moved);
      });
    }
    try {
      yield setArchivedMutation({ itemId, archived });
      return true;
    } catch (reason) {
      recordFailure(reason);
      return false;
    }
  });

  const model: ItemModel = {
    activeItems,
    archivedItems,
    areas: () => areaSource() ?? [],
    tags: () => tagSource() ?? [],
    profile: () => profileSource(),
    error,
    clearError: () => setError(null),
    inboxItems: () =>
      activeItems.filter(
        (item) => item.areaId === null && item.parentId === null,
      ),
    itemById: (itemId) =>
      itemId
        ? (activeItems.find((item) => item._id === itemId) ??
          archivedItems.find((item) => item._id === itemId))
        : undefined,
    childrenOf: (itemId) =>
      activeItems.filter((item) => item.parentId === itemId),
    quickCapture,
    createItem,
    updateItem,
    setTaskDone,
    setArchived,
  };

  return <ItemContext value={model}>{props.children}</ItemContext>;
}

export function useItems(): ItemModel {
  return useContext(ItemContext);
}
