import { select } from "./db";
import type { ItemView } from "./types";

/** Internal-only context. Remote mutation arguments cannot opt out of rules. */
export interface ItemProvenance {
  origin: "user" | "template" | "recurrence" | "project" | "obligation" | "checkpoint" | "automation";
  sourceId?: string;
}
export async function readPersistedItem(itemId: string): Promise<ItemView | null> {
  const [row] = await select<ItemView>("SELECT * FROM items WHERE _id=?", [itemId]);
  if (!row) return null;
  const tags = await select<{ name: string }>("SELECT tags.name FROM tags JOIN itemTags ON tags._id=itemTags.tagId WHERE itemTags.itemId=?", [itemId]);
  return { ...row, archived: Boolean(row.archived), tags: tags.map(t => t.name) };
}
