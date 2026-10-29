import { nanoid } from "nanoid";
import { z } from "zod";
import { data } from "./store";
import { run } from "./db";
import type { Id, ItemType } from "./types";
import type { ItemInput } from "./api";

const entrySchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["Task", "Note", "Event", "Expense", "Income"]),
  description: z.string().max(20000).default(""),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  dueOffset: z.number().int().min(-3650).max(3650).nullable().default(null),
  amount: z.union([z.number().finite().nonnegative(), z.string().max(100)]).nullable().default(null),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
});
export const templateSchema = z.object({ name: z.string().trim().min(1).max(80), entries: z.array(entrySchema).min(1).max(100) });
export type TemplateDefinition = z.infer<typeof templateSchema>;
export interface TemplateDoc {
  _id: string; workspaceId: string; name: string; version: number;
  definition: TemplateDefinition; createdAt: number; updatedAt: number; builtin?: boolean;
}
export type TemplateApply = { workspaceId: Id<"workspaces">; templateId: string; areaId?: Id<"areas"> | null; startDate: string; variables?: Record<string, string> };
export type CreateItem = (args: ItemInput & { workspaceId: Id<"workspaces"> }) => Promise<Id<"items">>;

export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Choose a valid date (YYYY-MM-DD).");
  return value;
}
export function addDays(date: string, days: number): string {
  const value = new Date(dateOnly(date) + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function requireWorkspace(workspaceId: string): void {
  if (!data.workspaces.some(w => w._id === workspaceId && !w.archived)) throw new Error("Choose an active Workspace.");
}
const entry = (title: string, type: ItemType = "Task", dueOffset: number | null = null) => entrySchema.parse({ title, type, dueOffset });
const starters: Record<string, TemplateDefinition> = {
  weekly: { name: "Weekly review", entries: [entry("Weekly review", "Note"), entry("Clear inbox", "Task", 0), entry("Review projects and waiting replies", "Task", 0), entry("Choose one outcome for next week", "Task", 0)] },
  kickoff: { name: "Project kickoff", entries: [entry("{{project}}", "Note"), entry("Define the smallest useful release", "Task", 0), entry("List blockers and dependencies", "Task", 1), entry("Ship the first useful version", "Task", 7)] },
  restart: { name: "Project restart", entries: [entry("Restart {{project}}", "Note"), entry("Read the last checkpoint", "Task", 0), entry("Reproduce the last working state", "Task", 0), entry("Timebox the next shipping step", "Task", 1)] },
  client: { name: "Client onboarding", entries: [entry("{{client}} onboarding", "Note"), entry("Confirm {{client}} scope and payment terms", "Task", 0), { ...entry("{{client}} deposit", "Income", 1), amount: "{{amount}}" }, entry("Book {{client}} kickoff", "Task", 2)] },
  delivery: { name: "Client delivery and payment", entries: [entry("{{client}} delivery", "Note"), { ...entry("Deliver {{project}}", "Task", 0), tags: ["delivery", "client"] }, entry("Confirm {{client}} acceptance", "Task", 1), entry("Follow up on {{client}} payment", "Task", 7)] },
  assignment: { name: "College assignment", entries: [entry("{{project}} assignment", "Note"), entry("Read requirements", "Task", 0), entry("Complete first draft", "Task", 2), entry("Review and submit", "Task", 4)] },
};
export function listTemplates(args: { workspaceId: string }): TemplateDoc[] {
  return [...Object.entries(starters).map(([key, definition]) => ({ _id: `starter:${key}`, workspaceId: args.workspaceId, name: definition.name, version: 1, definition, createdAt: 0, updatedAt: 0, builtin: true })), ...data.templates.filter(t => t.workspaceId === args.workspaceId)];
}
function getTemplate(workspaceId: string, templateId: string): TemplateDoc {
  const template = listTemplates({ workspaceId }).find(t => t._id === templateId);
  if (!template) throw new Error("Template not found in this Workspace.");
  return template;
}
export function templateVariables(definition: TemplateDefinition): string[] {
  return [...new Set([...JSON.stringify(definition.entries).matchAll(/\{\{([a-zA-Z][\w]*)\}\}/g)].map(m => m[1]))];
}
export function previewTemplate(args: TemplateApply): { template: TemplateDoc; items: ItemInput[] } {
  requireWorkspace(args.workspaceId);
  const template = getTemplate(args.workspaceId, args.templateId);
  const definition = templateSchema.parse(template.definition);
  dateOnly(args.startDate);
  if (args.areaId && !data.areas.some(a => a._id === args.areaId && a.workspaceId === args.workspaceId && !a.archived)) throw new Error("Area not found in this Workspace.");
  const substitute = (text: string) => text.replace(/\{\{([a-zA-Z][\w]*)\}\}/g, (_, key: string) => {
    const value = args.variables?.[key]?.trim();
    if (!value) throw new Error(`Fill in ${key}.`);
    return value;
  });
  const items = definition.entries.map(e => {
    const title = substitute(e.title);
    const amount = e.amount === null ? null : typeof e.amount === "number" ? e.amount : Number(substitute(e.amount));
    if (!title.trim() || title.length > 200 || (amount !== null && (!Number.isFinite(amount) || amount < 0))) throw new Error("Template values produce an invalid title or amount.");
    return { title, type: e.type, description: substitute(e.description) || null, tags: e.tags.map(substitute), dueDate: e.dueOffset === null ? null : addDays(args.startDate, e.dueOffset), areaId: args.areaId ?? null, parentId: null, priority: e.priority, amount, status: e.type === "Task" ? "Todo" as const : null, financialState: e.type === "Income" ? "Expected" as const : e.type === "Expense" ? "Planned" as const : null };
  });
  return { template, items };
}

export function createTemplates(createItem: CreateItem) {
  const save = async (args: { workspaceId: Id<"workspaces">; templateId?: string; definition: TemplateDefinition; expectedVersion?: number }) => {
    requireWorkspace(args.workspaceId);
    const definition = templateSchema.parse(args.definition);
    const existing = args.templateId ? getTemplate(args.workspaceId, args.templateId) : undefined;
    if (existing && !existing.builtin && args.expectedVersion !== undefined && existing.version !== args.expectedVersion) throw new Error("Template changed. Reload before saving.");
    const id = existing && !existing.builtin ? existing._id : nanoid();
    const version = existing && !existing.builtin ? existing.version + 1 : 1;
    const now = Date.now();
    await run("INSERT INTO templates (_id, workspaceId, name, version, definition, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(_id) DO UPDATE SET name=excluded.name, version=excluded.version, definition=excluded.definition, updatedAt=excluded.updatedAt", [id, args.workspaceId, definition.name, version, JSON.stringify(definition), now, now]);
    return id;
  };
  const apply = async (args: TemplateApply) => {
    const { template, items } = previewTemplate(args);
    let rootItemId: Id<"items"> | null = null;
    for (const item of items) {
      const id = await createItem({ ...item, workspaceId: args.workspaceId, parentId: rootItemId });
      rootItemId ??= id;
    }
    await run("INSERT INTO templateInstances (_id, workspaceId, templateId, templateVersion, rootItemId, createdAt) VALUES (?, ?, ?, ?, ?, ?)", [nanoid(), args.workspaceId, template._id, template.version, rootItemId, Date.now()]);
    return rootItemId!;
  };
  const saveFamily = async (args: { workspaceId: Id<"workspaces">; itemId: Id<"items">; name: string; startDate: string }) => {
    requireWorkspace(args.workspaceId);
    dateOnly(args.startDate);
    const root = data.items.find(i => i._id === args.itemId && i.workspaceId === args.workspaceId && !i.archived);
    if (!root || root.parentId) throw new Error("Select a top-level active Item family.");
    const members = [root, ...data.items.filter(i => i.parentId === root._id && !i.archived)];
    return save({ workspaceId: args.workspaceId, definition: { name: args.name, entries: members.map(i => ({ title: i.title, type: i.type ?? "Note", description: i.description ?? "", tags: [...i.tags], priority: i.priority ?? null, amount: i.amount ?? null, dueOffset: i.dueDate ? Math.round((Date.parse(i.dueDate) - Date.parse(args.startDate)) / 86400000) : null })) } });
  };
  const remove = async (args: { workspaceId: Id<"workspaces">; templateId: string }) => {
    requireWorkspace(args.workspaceId);
    if (getTemplate(args.workspaceId, args.templateId).builtin) throw new Error("Starter templates cannot be deleted. Duplicate one to customize it.");
    await run("DELETE FROM templates WHERE _id=? AND workspaceId=?", [args.templateId, args.workspaceId]);
    return null;
  };
  return { save, apply, saveFamily, remove };
}
