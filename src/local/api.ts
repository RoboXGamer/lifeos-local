import { nanoid } from "nanoid";
import { hasStorageAdapter, run, select, transaction } from "./db";
import { data, reload, applySnapshot } from "./store";
import { searchItems } from "./search";
import { createTemplates, listTemplates, previewTemplate } from "./templates";
import { createRecurrence, listSchedules, listOccurrences } from "./recurrence";
import { createAutomations } from "./automations";
import { createProjects, listProjects, listProjectSources, listProjectCheckpoints, resumeProject, reportProject } from "./projects";
import { createObligations, listEngagements, obligationDetails, obsoleteObligationItemIds } from "./obligations";
import { createAttention, buildAttention } from "./attention";
import { createHabits, listHabits, listGoals, listActivities, habitDetails, goalDetails } from "./habits";
import { readPersistedItem, type ItemProvenance } from "./item-events";
import type {
  AreaDoc,
  Id,
  ItemView,
  ProfileSummary,
  WorkspaceSummary,
} from "./types";
import {
  cleanAmount,
  cleanColor,
  cleanDescription,
  cleanDueDate,
  cleanIcon,
  cleanName,
  cleanTagName,
  cleanTitle,
} from "./validation";

export type ItemType = "Task" | "Note" | "Event" | "Expense" | "Income";
export type ItemStatus = "Todo" | "In Progress" | "Done";
export type FinancialState = "Planned" | "Spent" | "Expected" | "Received";

export interface ItemInput {
  title: string;
  areaId: Id<"areas"> | null;
  type: ItemType | null;
  status: ItemStatus | null;
  priority: 1 | 2 | 3 | null;
  dueDate: string | null;
  amount: number | null;
  financialState: FinancialState | null;
  description: string | null;
  parentId: Id<"items"> | null;
  tags: string[];
}

const uid = () => nanoid() as Id<string>;

/** Default tags created with every new Workspace. */
const defaultTags = [
  "urgent",
  "waiting",
  "recurring",
  "idea",
  "reference",
  "client",
  "order",
];

// ---------------------------------------------------------------- selectors

function visibleAreaIds(workspaceId: Id<"workspaces">): Set<string> {
  return new Set(
    data.areas
      .filter((area) => area.workspaceId === workspaceId && !area.archived)
      .map((area) => area._id),
  );
}

function itemsOf(workspaceId: Id<"workspaces">): ItemView[] {
  return data.items.filter((item) => item.workspaceId === workspaceId);
}

function itemOrThrow(itemId: Id<"items">): ItemView {
  const item = data.items.find((entry) => entry._id === itemId);
  if (!item) throw new Error("Item not found.");
  return item;
}

function timestamp(value: string | null | undefined): string | undefined {
  return cleanDueDate(value ?? undefined);
}

const list = (args: { workspaceId: Id<"workspaces"> }): ItemView[] => {
  const areas = visibleAreaIds(args.workspaceId);
  return itemsOf(args.workspaceId).filter(
    (item) =>
      !item.archived && (item.areaId === null || areas.has(item.areaId)),
  );
};

const listArchived = (args: { workspaceId: Id<"workspaces"> }): ItemView[] =>
  itemsOf(args.workspaceId).filter((item) => item.archived);

const listByArea = (args: { areaId: Id<"areas"> }): ItemView[] => {
  const area = data.areas.find((entry) => entry._id === args.areaId);
  if (!area || area.archived) return [];
  return data.items.filter(
    (item) => item.areaId === args.areaId && !item.archived,
  );
};

const listToday = (args: {
  workspaceId: Id<"workspaces">;
  date: string;
}): ItemView[] => {
  const date = timestamp(args.date);
  if (!date) return [];
  const areas = visibleAreaIds(args.workspaceId);
  const obsolete = obsoleteObligationItemIds(args.workspaceId);
  return itemsOf(args.workspaceId).filter(
    (item) =>
      item.dueDate === date &&
      !obsolete.has(item._id) &&
      !item.archived &&
      (item.areaId === null || areas.has(item.areaId)),
  );
};

const listUpcoming = (args: {
  workspaceId: Id<"workspaces">;
  afterDate: string;
  limit?: number;
}): ItemView[] => {
  const afterDate = timestamp(args.afterDate);
  if (!afterDate) return [];
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 150), 200));
  const areas = visibleAreaIds(args.workspaceId);
  const obsolete = obsoleteObligationItemIds(args.workspaceId);
  return itemsOf(args.workspaceId)
    .filter(
      (item) =>
        !!item.dueDate &&
        item.dueDate > afterDate &&
        !obsolete.has(item._id) &&
        !item.archived &&
        (item.type === "Task" || item.type === "Event") &&
        (item.areaId === null || areas.has(item.areaId)),
    )
    .slice(0, limit);
};

const search = (args: {
  workspaceId: Id<"workspaces">;
  searchTerm: string;
  limit?: number;
  type?: ItemType;
}): ItemView[] => {
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 40), 60));
  return searchItems(data.items, data.areas, args.workspaceId, args.searchTerm, limit, args.type);
};

const get = (args: { itemId: Id<"items"> }): ItemView | undefined =>
  data.items.find((item) => item._id === args.itemId);

function family(item: ItemView) {
  const rootId = item.parentId ?? item._id;
  const root = item.parentId
    ? data.items.find((entry) => entry._id === rootId)
    : item;
  if (!root) throw new Error("Parent Item not found.");
  const children = data.items.filter((entry) => entry.parentId === rootId);
  return { root, children };
}

const removalImpact = (args: { itemId: Id<"items"> }) => {
  const item = data.items.find((entry) => entry._id === args.itemId);
  if (!item) {
    return { rootId: args.itemId, rootTitle: "", itemCount: 0 };
  }
  const { root, children } = family(item);
  const target = item.parentId ? item : root;
  const members = item.parentId ? [item] : [root, ...children];
  return {
    rootId: target._id,
    rootTitle: target.title,
    itemCount: members.length,
  };
};

// --------------------------------------------------------------- mutations

function normalizedFields(input: ItemInput) {
  const type = input.type ?? undefined;
  const description = cleanDescription(input.description ?? undefined);
  const shared = {
    title: cleanTitle(input.title),
    type,
    priority: input.priority ?? undefined,
    dueDate: cleanDueDate(input.dueDate),
    description,
  };
  if (type === "Task") {
    return {
      ...shared,
      status: input.status ?? ("Todo" as const),
      amount: undefined,
      financialState: undefined,
    };
  }
  if (type === "Expense" || type === "Income") {
    const defaultState = type === "Expense" ? "Planned" : "Expected";
    const financialState = input.financialState ?? defaultState;
    if (
      (type === "Expense" &&
        financialState !== "Planned" &&
        financialState !== "Spent") ||
      (type === "Income" &&
        financialState !== "Expected" &&
        financialState !== "Received")
    ) {
      throw new Error(`Choose a valid ${type} status.`);
    }
    return {
      ...shared,
      status: undefined,
      amount: cleanAmount(input.amount),
      financialState,
    };
  }
  return {
    ...shared,
    status: undefined,
    amount: undefined,
    financialState: undefined,
  };
}

function validateLocation(
  workspaceId: Id<"workspaces">,
  areaId: Id<"areas"> | null,
  type: ItemType | null,
) {
  if (!areaId) return;
  if (!type) throw new Error("Choose an Item type before assigning an Area.");
  const area = data.areas.find((entry) => entry._id === areaId);
  if (!area || area.workspaceId !== workspaceId || area.archived) {
    throw new Error("Area not found.");
  }
}

async function requireItemCapacity(workspaceId: Id<"workspaces">) {
  const [row] = await select<{ count: number }>("SELECT COUNT(*) AS count FROM items WHERE workspaceId=?", [workspaceId]);
  if (row.count >= 500) {
    throw new Error("A Workspace can have at most 500 Items in V1.");
  }
}

async function setItemTags(
  itemId: Id<"items">,
  workspaceId: Id<"workspaces">,
  values: string[],
) {
  if (values.length > 12) throw new Error("Use no more than 12 tags per Item.");
  const normalized = [
    ...new Map(
      values.map((value) => {
        const tag = cleanTagName(value);
        return [tag.normalizedName, tag] as const;
      }),
    ).values(),
  ];
  await run("DELETE FROM itemTags WHERE itemId = ?", [itemId]);
  const existing = await select<{ _id: string; normalizedName: string }>(
    "SELECT _id, normalizedName FROM tags WHERE workspaceId = ?",
    [workspaceId],
  );
  const byName = new Map(existing.map((tag) => [tag.normalizedName, tag._id]));
  for (const value of normalized) {
    let tagId = byName.get(value.normalizedName);
    if (!tagId) {
      if (byName.size >= 200) {
        throw new Error("A Workspace can have at most 200 Tags.");
      }
      tagId = uid();
      const now = Date.now();
      await run(
        `INSERT INTO tags (_id, _creationTime, workspaceId, name, normalizedName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tagId, now, workspaceId, value.name, value.normalizedName, now],
      );
      byName.set(value.normalizedName, tagId);
    }
    const linkId = uid();
    const now = Date.now();
    await run(
      `INSERT INTO itemTags (_id, _creationTime, workspaceId, itemId, tagId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [linkId, now, workspaceId, itemId, tagId, now],
    );
  }
}

const ITEM_COLUMNS = `_id, _creationTime, workspaceId, title, areaId, type, status,
  priority, dueDate, amount, financialState, description, parentId, archived,
  createdAt, updatedAt`;

const quickCapture = async (args: {
  workspaceId: Id<"workspaces">;
  title: string;
}): Promise<Id<"items">> => {
  await requireItemCapacity(args.workspaceId);
  const now = Date.now();
  const itemId = uid() as Id<"items">;
  await run(
    `INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, ?, ?)`,
    [itemId, now, args.workspaceId, cleanTitle(args.title), now, now],
  );
  await automations.itemChanged(itemId, true);
  return itemId;
};

const create = async (
  args: { workspaceId: Id<"workspaces"> } & ItemInput,
  provenance: ItemProvenance = { origin: "user" },
): Promise<Id<"items">> => {
  await requireItemCapacity(args.workspaceId);
  let areaId = args.areaId;
  let parentId = args.parentId;
  if (parentId) {
    const [parent] = await select<ItemView>("SELECT * FROM items WHERE _id=?", [parentId]);
    if (!parent) throw new Error("Parent Item not found.");
    if (
      parent.workspaceId !== args.workspaceId ||
      parent.parentId ||
      parent.archived
    ) {
      throw new Error("Choose a top-level active parent Item.");
    }
    areaId = parent.areaId;
  }
  validateLocation(args.workspaceId, areaId, args.type);
  const now = Date.now();
  const fields = normalizedFields({ ...args, areaId, parentId });
  const itemId = uid() as Id<"items">;
  await run(
    `INSERT INTO items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      itemId,
      now,
      args.workspaceId,
      fields.title,
      areaId,
      fields.type ?? null,
      fields.status ?? null,
      fields.priority ?? null,
      fields.dueDate ?? null,
      fields.amount ?? null,
      fields.financialState ?? null,
      fields.description ?? null,
      parentId,
      now,
      now,
    ],
  );
  await setItemTags(itemId, args.workspaceId, args.tags);
  await automations.itemChanged(itemId, true, undefined, provenance);
  return itemId;
};

const update = async (
  args: {
    itemId: Id<"items">;
    expectedUpdatedAt?: number;
  } & ItemInput,
  provenance: ItemProvenance = { origin: "user" },
): Promise<null> => {
  const item = itemOrThrow(args.itemId);
  const previous = await readPersistedItem(args.itemId);
  const currentFamily = family(item);
  let areaId = args.areaId;
  let parentId = args.parentId;

  if (item.parentId && areaId !== item.areaId) {
    if (areaId !== null) {
      throw new Error("Move the parent Item to move this family.");
    }
    parentId = null;
  }
  const ownChildren = item.parentId ? [] : currentFamily.children;

  if (ownChildren.length > 0 && parentId) {
    throw new Error("An Item with children cannot become a child.");
  }
  if (parentId) {
    const parent = itemOrThrow(parentId);
    if (
      parent._id === item._id ||
      parent.workspaceId !== item.workspaceId ||
      parent.parentId ||
      parent.archived
    ) {
      throw new Error("Choose a top-level active parent Item.");
    }
    areaId = parent.areaId;
  }
  validateLocation(item.workspaceId, areaId, args.type);
  const now = Date.now();
  const fields = normalizedFields({ ...args, areaId, parentId });
  await run(
    `UPDATE items SET
       title = ?, areaId = ?, type = ?, status = ?, priority = ?, dueDate = ?,
       amount = ?, financialState = ?, description = ?, parentId = ?, updatedAt = ?
     WHERE _id = ?`,
    [
      fields.title,
      areaId,
      fields.type ?? null,
      fields.status ?? null,
      fields.priority ?? null,
      fields.dueDate ?? null,
      fields.amount ?? null,
      fields.financialState ?? null,
      fields.description ?? null,
      parentId,
      now,
      item._id,
    ],
  );
  if (!item.parentId && areaId !== item.areaId) {
    for (const child of currentFamily.children) {
      await run("UPDATE items SET areaId = ?, updatedAt = ? WHERE _id = ?", [
        areaId,
        now,
        child._id,
      ]);
    }
  }
  await setItemTags(item._id, item.workspaceId, args.tags);
  await automations.itemChanged(item._id, false, previous?.status, provenance);
  return null;
};

const setTaskDone = async (args: {
  itemId: Id<"items">;
  done: boolean;
}): Promise<null> => {
  const item = itemOrThrow(args.itemId);
  if (item.type !== "Task") throw new Error("Only Tasks can be completed.");
  const previous = await readPersistedItem(item._id);
  await run("UPDATE items SET status = ?, updatedAt = ? WHERE _id = ?", [
    args.done ? "Done" : "Todo",
    Date.now(),
    item._id,
  ]);
  await automations.itemChanged(item._id, false, previous?.status);
  return null;
};

const setArchived = async (args: {
  itemId: Id<"items">;
  archived: boolean;
}): Promise<null> => {
  const item = itemOrThrow(args.itemId);
  const { root, children } = family(item);
  const members = item.parentId ? [item] : [root, ...children];
  const now = Date.now();
  for (const member of members) {
    await run("UPDATE items SET archived = ?, updatedAt = ? WHERE _id = ?", [
      args.archived ? 1 : 0,
      now,
      member._id,
    ]);
  }
  return null;
};

const remove = async (args: {
  itemId: Id<"items">;
  confirmation: string;
}): Promise<null> => {
  const item = itemOrThrow(args.itemId);
  const { root, children } = family(item);
  const target = item.parentId ? item : root;
  const members = item.parentId ? [item] : [root, ...children];
  if (members.some((member) => !member.archived)) {
    throw new Error(
      item.parentId
        ? "Archive this Item before deleting it."
        : "Archive this Item family before deleting it.",
    );
  }
  if (args.confirmation.trim() !== target.title) {
    throw new Error("Type the Item title exactly to confirm deletion.");
  }
  for (const member of members) {
    await run("DELETE FROM itemTags WHERE itemId = ?", [member._id]);
    await run("DELETE FROM items WHERE _id = ?", [member._id]);
  }
  return null;
};

// -------------------------------------------------------------------- areas

const areasList = (args: { workspaceId: Id<"workspaces"> }): AreaDoc[] =>
  data.areas.filter(
    (area) => area.workspaceId === args.workspaceId && !area.archived,
  );

const areasListArchived = (args: {
  workspaceId: Id<"workspaces">;
}): AreaDoc[] =>
  data.areas.filter(
    (area) => area.workspaceId === args.workspaceId && area.archived,
  );

const areasGet = (args: { areaId: Id<"areas"> }): AreaDoc | null =>
  data.areas.find((area) => area._id === args.areaId) ?? null;

export interface AreaInput {
  name: string;
  description?: string;
  icon: string;
  color: string;
}

const areasCreate = async (
  args: { workspaceId: Id<"workspaces"> } & AreaInput,
): Promise<Id<"areas">> => {
  if (
    data.areas.filter((area) => area.workspaceId === args.workspaceId).length >=
    100
  ) {
    throw new Error("A Workspace can have at most 100 Areas.");
  }
  const now = Date.now();
  const areaId = uid() as Id<"areas">;
  await run(
    `INSERT INTO areas (_id, _creationTime, workspaceId, name, icon, color, description, archived, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      areaId,
      now,
      args.workspaceId,
      cleanName(args.name, "Area name"),
      cleanIcon(args.icon),
      cleanColor(args.color),
      cleanDescription(args.description) ?? null,
      now,
      now,
    ],
  );
  return areaId;
};

const areasUpdate = async (
  args: {
    areaId: Id<"areas">;
    expectedUpdatedAt?: number;
  } & AreaInput,
): Promise<null> => {
  const area = data.areas.find((entry) => entry._id === args.areaId);
  if (!area) throw new Error("Area not found.");
  await run(
    `UPDATE areas SET name = ?, description = ?, icon = ?, color = ?, updatedAt = ? WHERE _id = ?`,
    [
      cleanName(args.name, "Area name"),
      cleanDescription(args.description) ?? null,
      cleanIcon(args.icon),
      cleanColor(args.color),
      Date.now(),
      area._id,
    ],
  );
  return null;
};

const areasSetArchived = async (args: {
  areaId: Id<"areas">;
  archived: boolean;
}): Promise<null> => {
  const area = data.areas.find((entry) => entry._id === args.areaId);
  if (!area) throw new Error("Area not found.");
  await run("UPDATE areas SET archived = ?, updatedAt = ? WHERE _id = ?", [
    args.archived ? 1 : 0,
    Date.now(),
    area._id,
  ]);
  return null;
};

const areasRemovalImpact = (args: { areaId: Id<"areas"> }) => {
  const area = data.areas.find((entry) => entry._id === args.areaId);
  if (!area) return { itemCount: 0, tooLarge: false };
  const items = data.items.filter(
    (item) => item.workspaceId === area.workspaceId && item.areaId === area._id,
  );
  return { itemCount: items.length, tooLarge: items.length > 500 };
};

const areasRemove = async (args: {
  areaId: Id<"areas">;
  confirmation: string;
}): Promise<null> => {
  const area = data.areas.find((entry) => entry._id === args.areaId);
  if (!area) throw new Error("Area not found.");
  if (!area.archived) throw new Error("Archive this Area before deleting it.");
  if (args.confirmation.trim() !== area.name) {
    throw new Error("Type the Area name exactly to confirm deletion.");
  }
  const items = data.items.filter(
    (item) => item.workspaceId === area.workspaceId && item.areaId === area._id,
  );
  if (items.length > 500) {
    throw new Error("This Area is too large for immediate deletion.");
  }
  for (const item of items) {
    await run("DELETE FROM itemTags WHERE itemId = ?", [item._id]);
    await run("DELETE FROM items WHERE _id = ?", [item._id]);
  }
  await run("DELETE FROM areas WHERE _id = ?", [area._id]);
  return null;
};

// --------------------------------------------------------------------- tags

const tagsList = (args: { workspaceId: Id<"workspaces"> }) =>
  data.tags
    .filter((tag) => tag.workspaceId === args.workspaceId)
    .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));

const tagsListWithCounts = (args: { workspaceId: Id<"workspaces"> }) => {
  const counts = new Map<string, number>();
  for (const link of data.itemTags) {
    if (link.workspaceId !== args.workspaceId) continue;
    counts.set(link.tagId, (counts.get(link.tagId) ?? 0) + 1);
  }
  return tagsList(args).map((tag) => {
    const count = counts.get(tag._id) ?? 0;
    return {
      ...tag,
      itemCount: Math.min(count, 300),
      countIsLimited: count > 300,
    };
  });
};

const tagsRename = async (args: {
  tagId: Id<"tags">;
  name: string;
}): Promise<null> => {
  const tag = data.tags.find((entry) => entry._id === args.tagId);
  if (!tag) throw new Error("Tag not found.");
  const clean = cleanTagName(args.name);
  const collision = data.tags.find(
    (entry) =>
      entry.workspaceId === tag.workspaceId &&
      entry.normalizedName === clean.normalizedName,
  );
  if (collision && collision._id !== tag._id) {
    throw new Error("That Tag already exists in this Workspace.");
  }
  await run("UPDATE tags SET name = ?, normalizedName = ? WHERE _id = ?", [
    clean.name,
    clean.normalizedName,
    tag._id,
  ]);
  return null;
};

const tagsRemove = async (args: { tagId: Id<"tags"> }): Promise<null> => {
  const tag = data.tags.find((entry) => entry._id === args.tagId);
  if (!tag) return null;
  if (data.itemTags.some((link) => link.tagId === tag._id)) {
    throw new Error("Remove this Tag from its Items before deleting it.");
  }
  await run("DELETE FROM tags WHERE _id = ?", [tag._id]);
  return null;
};

// --------------------------------------------------------------- workspaces

const workspacesList = (): {
  activeWorkspaceId: Id<"workspaces"> | null;
  workspaces: WorkspaceSummary[];
} => {
  const profile = data.profile;
  return {
    activeWorkspaceId: profile?.activeWorkspaceId ?? null,
    workspaces: data.workspaces
      .filter((workspace) => !workspace.archived)
      .map((workspace) => ({
        id: workspace._id,
        name: workspace.name,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })),
  };
};

const workspacesListArchived = () =>
  data.workspaces.filter((workspace) => workspace.archived);

async function setActiveWorkspace(
  profileId: Id<"profiles">,
  workspaceId: Id<"workspaces"> | null,
) {
  await run(
    "UPDATE profiles SET activeWorkspaceId = ?, updatedAt = ? WHERE _id = ?",
    [workspaceId, Date.now(), profileId],
  );
}

const workspacesCreate = async (args: {
  name: string;
}): Promise<Id<"workspaces">> => {
  const profile = data.profile;
  if (!profile) throw new Error("Profile not found.");
  if (data.workspaces.length >= 100) {
    throw new Error("A profile can have at most 100 Workspaces.");
  }
  const now = Date.now();
  const workspaceId = uid() as Id<"workspaces">;
  await run(
    `INSERT INTO workspaces (_id, _creationTime, ownerId, name, archived, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [workspaceId, now, profile._id, cleanName(args.name, "Workspace name"), now, now],
  );
  for (const name of defaultTags) {
    await run(
      `INSERT INTO tags (_id, _creationTime, workspaceId, name, normalizedName, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uid(), now, workspaceId, name, name, now],
    );
  }
  await setActiveWorkspace(profile._id, workspaceId);
  return workspaceId;
};

const workspacesRename = async (args: {
  workspaceId: Id<"workspaces">;
  name: string;
  expectedUpdatedAt?: number;
}): Promise<null> => {
  const workspace = data.workspaces.find(
    (entry) => entry._id === args.workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found.");
  await run("UPDATE workspaces SET name = ?, updatedAt = ? WHERE _id = ?", [
    cleanName(args.name, "Workspace name"),
    Date.now(),
    workspace._id,
  ]);
  return null;
};

const workspacesSelect = async (args: {
  workspaceId: Id<"workspaces">;
}): Promise<null> => {
  const profile = data.profile;
  if (!profile) throw new Error("Profile not found.");
  const workspace = data.workspaces.find(
    (entry) => entry._id === args.workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found.");
  if (workspace.archived) throw new Error("Restore this Workspace first.");
  await setActiveWorkspace(profile._id, workspace._id);
  return null;
};

const workspacesSetArchived = async (args: {
  workspaceId: Id<"workspaces">;
  archived: boolean;
}): Promise<null> => {
  const profile = data.profile;
  if (!profile) throw new Error("Profile not found.");
  const workspace = data.workspaces.find(
    (entry) => entry._id === args.workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found.");
  if (args.archived) {
    const active = data.workspaces.filter((entry) => !entry.archived);
    if (active.length <= 1) {
      throw new Error("Keep at least one active Workspace.");
    }
  }
  await run("UPDATE workspaces SET archived = ?, updatedAt = ? WHERE _id = ?", [
    args.archived ? 1 : 0,
    Date.now(),
    workspace._id,
  ]);
  if (args.archived && profile.activeWorkspaceId === workspace._id) {
    const next = data.workspaces.find(
      (entry) => entry._id !== workspace._id && !entry.archived,
    );
    await setActiveWorkspace(profile._id, next?._id ?? null);
  }
  return null;
};

const workspacesRemovalImpact = (args: { workspaceId: Id<"workspaces"> }) => {
  const areas = data.areas.filter(
    (area) => area.workspaceId === args.workspaceId,
  );
  const items = itemsOf(args.workspaceId);
  return {
    areaCount: areas.length,
    itemCount: items.length,
    tooLarge: areas.length > 500 || items.length > 500,
  };
};

const workspacesRemove = async (args: {
  workspaceId: Id<"workspaces">;
  confirmation: string;
}): Promise<null> => {
  const profile = data.profile;
  if (!profile) throw new Error("Profile not found.");
  const workspace = data.workspaces.find(
    (entry) => entry._id === args.workspaceId,
  );
  if (!workspace) throw new Error("Workspace not found.");
  if (!workspace.archived) {
    throw new Error("Archive this Workspace before deleting it.");
  }
  if (args.confirmation.trim() !== workspace.name) {
    throw new Error("Type the Workspace name exactly to confirm deletion.");
  }
  const areas = data.areas.filter(
    (area) => area.workspaceId === workspace._id,
  );
  const items = itemsOf(workspace._id);
  const tags = data.tags.filter((tag) => tag.workspaceId === workspace._id);
  const itemTags = data.itemTags.filter(
    (link) => link.workspaceId === workspace._id,
  );
  if (
    areas.length > 500 ||
    items.length > 500 ||
    tags.length > 500 ||
    itemTags.length > 500
  ) {
    throw new Error("This Workspace is too large for immediate deletion.");
  }
  await run("DELETE FROM itemTags WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM templateInstances WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM templates WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM projectPlanTasks WHERE projectId IN (SELECT _id FROM projects WHERE workspaceId=?)", [workspace._id]);
  for (const table of ["obligationReviews", "itemMutationEvents", "recurrenceOccurrences", "recurrenceSchedules", "automationRuns", "automations", "projectSources", "projectCheckpoints", "projects", "paymentAllocations", "obligationPayments", "obligationInvoices", "obligationFollowups", "commitments", "obligationDocuments", "engagements", "attentionFeedback", "itemEstimates", "habitGoalLinks", "activityGoalLinks", "activityRevisions", "activityEntries", "habitDayMarks", "habitVersions", "goalVersions", "habits", "goals"]) {
    await run(`DELETE FROM ${table} WHERE workspaceId=?`, [workspace._id]);
  }
  await run("DELETE FROM items WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM tags WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM areas WHERE workspaceId = ?", [workspace._id]);
  await run("DELETE FROM workspaces WHERE _id = ?", [workspace._id]);
  if (profile.activeWorkspaceId === workspace._id) {
    await setActiveWorkspace(profile._id, null);
  }
  return null;
};

// ----------------------------------------------------------------- profiles

/** Creates the singleton local profile + "My Life" workspace on first launch. */
async function bootstrapProfile(): Promise<void> {
  const now = Date.now();
  let profiles = await select<Record<string, unknown>>(
    "SELECT * FROM profiles LIMIT 1",
  );
  let profile = profiles[0];
  if (!profile) {
    const profileId = uid();
    await run(
      `INSERT INTO profiles (_id, _creationTime, authUserId, isAnonymous, role, suspended, createdAt, updatedAt)
       VALUES (?, ?, 'local', 0, 'user', 0, ?, ?)`,
      [profileId, now, now, now],
    );
    profiles = await select<Record<string, unknown>>(
      "SELECT * FROM profiles LIMIT 1",
    );
    profile = profiles[0];
  }
  if (!profile) throw new Error("Local profile could not be created.");

  const workspaces = await select<Record<string, unknown>>(
    "SELECT * FROM workspaces WHERE ownerId = ? ORDER BY createdAt",
    [profile._id],
  );

  if (workspaces.length === 0) {
    const workspaceId = uid();
    await run(
      `INSERT INTO workspaces (_id, _creationTime, ownerId, name, archived, createdAt, updatedAt)
       VALUES (?, ?, ?, 'My Life', 0, ?, ?)`,
      [workspaceId, now, profile._id, now, now],
    );
    for (const name of defaultTags) {
      await run(
        `INSERT INTO tags (_id, _creationTime, workspaceId, name, normalizedName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uid(), now, workspaceId, name, name, now],
      );
    }
    await run(
      "UPDATE profiles SET activeWorkspaceId = ?, updatedAt = ? WHERE _id = ?",
      [workspaceId, now, profile._id],
    );
  } else {
    const active = workspaces.find(
      (workspace) =>
        workspace._id === profile.activeWorkspaceId && !workspace.archived,
    );
    if (!active) {
      const fallback = workspaces.find((workspace) => !workspace.archived);
      await run(
        "UPDATE profiles SET activeWorkspaceId = ?, updatedAt = ? WHERE _id = ?",
        [fallback?._id ?? null, now, profile._id],
      );
    }
  }

}

let remoteMutation: ((name: string, args: unknown) => Promise<{ result: unknown; state: import('./store').DbState; epoch: string; revision: number }>) | undefined;
export function enableRemoteMutations(executor: typeof remoteMutation): void { remoteMutation = executor; }

function transactional<A, R>(name: string, mutation: (args: A) => Promise<R>): (args: A) => Promise<R> {
  return async (args) => {
    if (!remoteMutation) {
      if (!hasStorageAdapter()) throw new Error("The local service is not connected");
      return transaction(async () => {
        const result = await mutation(args);
        await recurrence.afterMutation(name, args, result);
        return result;
      }, reload);
    }
    const response = await remoteMutation(name, args);
    applySnapshot(response);
    return response.result as R;
  };
}

export function ensureProfile(): Promise<void> {
  return transaction(bootstrapProfile, reload);
}

const profilesCurrent = (): ProfileSummary | undefined => {
  const profile = data.profile;
  if (!profile) return undefined;
  return {
    id: profile._id,
    username: profile.username ?? null,
    email: profile.email ?? null,
    isAnonymous: profile.isAnonymous,
    role: profile.role,
    activeWorkspaceId: profile.activeWorkspaceId ?? null,
    usernameChangedAt: profile.usernameChangedAt ?? null,
  };
};

// ---------------------------------------------------------------------- api

const templates = createTemplates(create);
const recurrence = createRecurrence(create);
const automations = createAutomations({ createItem: create, applyTemplate: templates.apply, updateItem: update });
const projects = createProjects({ createItem: create });
const obligations = createObligations(create, update);
const attention = createAttention();
const habits = createHabits({ onTargetReached: automations.onTargetReached });

// Service-only entry point: the clock is never accepted from remote clients.
export function tickRecurring(now = Date.now()) {
  return transaction(() => recurrence.tick({ now }), reload);
}
export function runProductivityTasks(now = Date.now()) {
  return transaction(async () => {
    const [before] = await select<{ changes: number }>("SELECT total_changes() AS changes");
    await recurrence.tick({ now });
    await automations.tick({ now });
    const [after] = await select<{ changes: number }>("SELECT total_changes() AS changes");
    return after.changes - before.changes;
  }, reload);
}

export const api = {
  habits: { list: listHabits, details: habitDetails, save: transactional('habits.save', habits.saveHabit), mark: transactional('habits.mark', habits.mark) },
  goals: { list: listGoals, details: goalDetails, save: transactional('goals.save', habits.saveGoal) },
  activity: { list: listActivities, log: transactional('activity.log', habits.log), edit: transactional('activity.edit', habits.edit), void: transactional('activity.void', habits.voidActivity) },
  attention: { build: buildAttention, feedback: transactional('attention.feedback', attention.feedback), estimate: transactional('attention.estimate', attention.estimate) },
  automations: {
    list: automations.list, runs: automations.runs, recipes: automations.recipes, preview: automations.preview,
    save: transactional('automations.save', automations.save),
    setEnabled: transactional('automations.setEnabled', automations.setEnabled),
    remove: transactional('automations.remove', automations.remove),
    retry: transactional('automations.retry', automations.retry),
    checkpoint: transactional('automations.checkpoint', automations.checkpoint),
  },
  projects: {
    list: listProjects, sources: listProjectSources, checkpoints: listProjectCheckpoints, resume: resumeProject, report: reportProject,
    create: transactional('projects.create', projects.create), update: transactional('projects.update', projects.update),
    checkpoint: transactional('projects.checkpoint', projects.checkpoint), addSource: transactional('projects.addSource', projects.addSource),
    scan: transactional('projects.scan', projects.scan), acceptPlan: transactional('projects.acceptPlan', projects.acceptPlan),
    removeSource: transactional('projects.removeSource', projects.removeSource), remove: transactional('projects.remove', projects.remove),
  },
  obligations: {
    list: listEngagements, details: obligationDetails,
    create: transactional('obligations.create', obligations.create), addDocument: transactional('obligations.addDocument', obligations.addDocument),
    extract: transactional('obligations.extract', obligations.extract), review: transactional('obligations.review', obligations.review),
    addInvoice: transactional('obligations.addInvoice', obligations.addInvoice), recordPayment: transactional('obligations.recordPayment', obligations.recordPayment),
    allocate: transactional('obligations.allocate', obligations.allocate), createFollowup: transactional('obligations.createFollowup', obligations.createFollowup),
  },
  recurrence: {
    list: listSchedules,
    history: listOccurrences,
    save: transactional('recurrence.save', recurrence.save),
    control: transactional('recurrence.control', recurrence.control),
  },
  templates: {
    list: listTemplates,
    preview: previewTemplate,
    save: transactional('templates.save', templates.save),
    saveFamily: transactional('templates.saveFamily', templates.saveFamily),
    apply: transactional('templates.apply', templates.apply),
    remove: transactional('templates.remove', templates.remove),
  },
  items: {
    list,
    listArchived,
    listByArea,
    listToday,
    listUpcoming,
    search,
    get,
    removalImpact,
    quickCapture: transactional('items.quickCapture', quickCapture),
    create: transactional('items.create', create),
    update: transactional('items.update', update),
    setTaskDone: transactional('items.setTaskDone', setTaskDone),
    setArchived: transactional('items.setArchived', setArchived),
    remove: transactional('items.remove', remove),
  },
  areas: {
    list: areasList,
    listArchived: areasListArchived,
    get: areasGet,
    removalImpact: areasRemovalImpact,
    create: transactional('areas.create', areasCreate),
    update: transactional('areas.update', areasUpdate),
    setArchived: transactional('areas.setArchived', areasSetArchived),
    remove: transactional('areas.remove', areasRemove),
  },
  tags: {
    list: tagsList,
    listWithCounts: tagsListWithCounts,
    rename: transactional('tags.rename', tagsRename),
    remove: transactional('tags.remove', tagsRemove),
  },
  workspaces: {
    list: workspacesList,
    listArchived: workspacesListArchived,
    removalImpact: workspacesRemovalImpact,
    create: transactional('workspaces.create', workspacesCreate),
    rename: transactional('workspaces.rename', workspacesRename),
    select: transactional('workspaces.select', workspacesSelect),
    setArchived: transactional('workspaces.setArchived', workspacesSetArchived),
    remove: transactional('workspaces.remove', workspacesRemove),
  },
  profiles: {
    bootstrap: ensureProfile,
    current: profilesCurrent,
  },
};
