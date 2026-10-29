import { createStore, reconcile } from "solid-js";
import { select } from "./db";
import type {
  AreaDoc,
  Id,
  ItemDoc,
  ItemTagDoc,
  ItemView,
  ProfileDoc,
  TagDoc,
  WorkspaceDoc,
} from "./types";

export interface DbState {
  profile: ProfileDoc | undefined;
  workspaces: WorkspaceDoc[];
  areas: AreaDoc[];
  items: ItemView[];
  tags: TagDoc[];
  itemTags: ItemTagDoc[];
}

const emptyState: DbState = {
  profile: undefined,
  workspaces: [],
  areas: [],
  items: [],
  tags: [],
  itemTags: [],
};

export const [data, setData] = createStore<DbState>(emptyState);

let currentEpoch: string | undefined;
let currentRevision = -1;
export function applySnapshot(update: { epoch: string; revision: number; state: DbState }): void {
  if (currentEpoch === update.epoch && update.revision < currentRevision) return;
  currentEpoch = update.epoch;
  currentRevision = update.revision;
  const next = update.state;
  setData((state) => {
    state.profile = next.profile;
    reconcile(next.workspaces, "_id")(state.workspaces);
    reconcile(next.areas, "_id")(state.areas);
    reconcile(next.items, "_id")(state.items);
    reconcile(next.tags, "_id")(state.tags);
    reconcile(next.itemTags, "_id")(state.itemTags);
  });
}

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return String(value ?? "");
}

function optional<T>(value: unknown): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}

function mapProfile(row: Row): ProfileDoc {
  return {
    _id: str(row._id) as Id<"profiles">,
    _creationTime: Number(row._creationTime),
    authUserId: str(row.authUserId),
    ...(optional<string>(row.username) !== undefined
      ? { username: str(row.username) }
      : {}),
    ...(optional<string>(row.normalizedUsername) !== undefined
      ? { normalizedUsername: str(row.normalizedUsername) }
      : {}),
    ...(optional<string>(row.email) !== undefined
      ? { email: str(row.email) }
      : {}),
    isAnonymous: Number(row.isAnonymous) === 1,
    role: row.role === "admin" ? "admin" : "user",
    suspended: Number(row.suspended) === 1,
    ...(optional<string>(row.activeWorkspaceId) !== undefined
      ? { activeWorkspaceId: str(row.activeWorkspaceId) as Id<"workspaces"> }
      : {}),
    ...(row.usernameChangedAt != null
      ? { usernameChangedAt: Number(row.usernameChangedAt) }
      : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapWorkspace(row: Row): WorkspaceDoc {
  return {
    _id: str(row._id) as Id<"workspaces">,
    _creationTime: Number(row._creationTime),
    ...(optional<string>(row.ownerId) !== undefined
      ? { ownerId: str(row.ownerId) as Id<"profiles"> }
      : {}),
    name: str(row.name),
    ...(row.archived != null ? { archived: Number(row.archived) === 1 } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapArea(row: Row): AreaDoc {
  return {
    _id: str(row._id) as Id<"areas">,
    _creationTime: Number(row._creationTime),
    workspaceId: str(row.workspaceId) as Id<"workspaces">,
    name: str(row.name),
    icon: str(row.icon),
    color: str(row.color),
    ...(optional<string>(row.description) !== undefined
      ? { description: str(row.description) }
      : {}),
    archived: Number(row.archived) === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapItem(row: Row): ItemDoc {
  return {
    _id: str(row._id) as Id<"items">,
    _creationTime: Number(row._creationTime),
    workspaceId: str(row.workspaceId) as Id<"workspaces">,
    title: str(row.title),
    areaId: (row.areaId ?? null) as Id<"areas"> | null,
    ...(optional<string>(row.type) !== undefined
      ? { type: row.type as ItemDoc["type"] }
      : {}),
    ...(optional<string>(row.status) !== undefined
      ? { status: row.status as ItemDoc["status"] }
      : {}),
    ...(row.priority != null
      ? { priority: Number(row.priority) as 1 | 2 | 3 }
      : {}),
    ...(optional<string>(row.dueDate) !== undefined
      ? { dueDate: str(row.dueDate) }
      : {}),
    ...(row.amount != null ? { amount: Number(row.amount) } : {}),
    ...(optional<string>(row.financialState) !== undefined
      ? { financialState: row.financialState as ItemDoc["financialState"] }
      : {}),
    ...(optional<string>(row.description) !== undefined
      ? { description: str(row.description) }
      : {}),
    parentId: (row.parentId ?? null) as Id<"items"> | null,
    archived: Number(row.archived) === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function mapTag(row: Row): TagDoc {
  return {
    _id: str(row._id) as Id<"tags">,
    _creationTime: Number(row._creationTime),
    workspaceId: str(row.workspaceId) as Id<"workspaces">,
    name: str(row.name),
    normalizedName: str(row.normalizedName),
    createdAt: Number(row.createdAt),
  };
}

function mapItemTag(row: Row): ItemTagDoc {
  return {
    _id: str(row._id) as Id<"itemTags">,
    _creationTime: Number(row._creationTime),
    workspaceId: str(row.workspaceId) as Id<"workspaces">,
    itemId: str(row.itemId) as Id<"items">,
    tagId: str(row.tagId) as Id<"tags">,
    createdAt: Number(row.createdAt),
  };
}

function attachTags(
  items: ItemDoc[],
  tags: TagDoc[],
  links: ItemTagDoc[],
): ItemView[] {
  const nameById = new Map<string, string>();
  for (const tag of tags) nameById.set(tag._id, tag.name);
  const byItem = new Map<string, string[]>();
  for (const link of links) {
    const name = nameById.get(link.tagId);
    if (!name) continue;
    const list = byItem.get(link.itemId);
    if (list) list.push(name);
    else byItem.set(link.itemId, [name]);
  }
  return items.map((item) => ({ ...item, tags: byItem.get(item._id) ?? [] }));
}

/** Reads every table into the reactive store. Personal scale: a full reload is a few ms. */
export async function reload(): Promise<void> {
  const [profiles, workspaces, areas, items, tags, itemTags] = await Promise.all([
    select<Row>("SELECT * FROM profiles LIMIT 1"),
    select<Row>("SELECT * FROM workspaces ORDER BY createdAt"),
    select<Row>("SELECT * FROM areas ORDER BY createdAt"),
    select<Row>("SELECT * FROM items ORDER BY createdAt"),
    select<Row>("SELECT * FROM tags ORDER BY normalizedName"),
    select<Row>("SELECT * FROM itemTags"),
  ]);

  const mappedTags = tags.map(mapTag);
  const mappedLinks = itemTags.map(mapItemTag);
  const view = attachTags(items.map(mapItem), mappedTags, mappedLinks);

  setData((state) => {
    state.profile = profiles[0] ? mapProfile(profiles[0]) : undefined;
    reconcile(workspaces.map(mapWorkspace), "_id")(state.workspaces);
    reconcile(areas.map(mapArea), "_id")(state.areas);
    reconcile(view, "_id")(state.items);
    reconcile(mappedTags, "_id")(state.tags);
    reconcile(mappedLinks, "_id")(state.itemTags);
  });
}
