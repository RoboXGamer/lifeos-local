import { nanoid } from "nanoid";
import { z } from "zod";
import { run, select } from "./db";
import { data } from "./store";
import { addDays, dateOnly, requireWorkspace, previewTemplate } from "./templates";
import type { CreateItem, TemplateApply } from "./templates";
import type { ItemInput } from "./api";
import type { Id, ItemView } from "./types";
import { readPersistedItem as readItem, type ItemProvenance } from "./item-events";
import { habitDetails, goalDetails } from "./habits";
import type { HabitTargetEvent } from "./habits";

const timezoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "Choose a valid timezone.");
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(12);
export const automationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  trigger: z.object({
    kind: z.enum(["schedule", "item_created", "status_changed", "due_date", "inactivity", "habit_target_met", "goal_target_reached"]),
    entityId: z.string().nullable().default(null),
    timezone: timezoneSchema.default("UTC"),
    weekday: z.number().int().min(0).max(6).default(5),
    days: z.number().int().min(1).max(3650).default(14),
  }),
  conditions: z.object({
    areaId: z.string().nullable().default(null),
    type: z.enum(["Task", "Note", "Event", "Expense", "Income"]).nullable().default(null),
    status: z.enum(["Todo", "In Progress", "Done"]).nullable().default(null),
    tags: tagsSchema.default([]),
  }).default({ areaId: null, type: null, status: null, tags: [] }),
  action: z.object({
    kind: z.enum(["create_item", "apply_template", "update_item", "reminder"]),
    title: z.string().trim().min(1).max(200).default("Follow up: {{title}}"),
    description: z.string().max(12000).default(""),
    type: z.enum(["Task", "Note", "Event"]).default("Task"),
    tags: tagsSchema.default([]),
    dueOffset: z.number().int().min(-3650).max(3650).default(0),
    templateId: z.string().max(100).default("starter:weekly"),
    variables: z.record(z.string(), z.string().max(1000)).default({}),
    status: z.enum(["Todo", "In Progress", "Done"]).nullable().default(null),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().default(null),
  }),
});
export type AutomationDefinition = z.infer<typeof automationSchema>;
export interface AutomationDoc {
  _id: string; workspaceId: string; name: string; enabled: boolean;
  definition: AutomationDefinition; nextRunDate: string | null; createdAt: number; updatedAt: number;
}
export interface AutomationInput {
  explanation: string; date: string; item: ItemView | null; definition: AutomationDefinition;
  event?: { id: string; origin: ItemProvenance["origin"]; sourceId?: string };
  progress?: HabitTargetEvent;
}
export interface AutomationRunDoc {
  _id: string; workspaceId: string; automationId: string; eventKey: string;
  status: "pending" | "completed" | "failed" | "cancelled";
  attempts: number; nextAttempt: number; input: AutomationInput;
  result: { itemId?: string; message: string } | null; error: string | null;
  createdAt: number; updatedAt: number;
}
interface Dependencies {
  createItem: CreateItem;
  applyTemplate: (args: TemplateApply, provenance?: ItemProvenance) => Promise<Id<"items">>;
  updateItem: (args: ItemInput & { itemId: Id<"items"> }, provenance?: ItemProvenance) => Promise<unknown>;
}
type RuleRow = Omit<AutomationDoc, "definition" | "enabled"> & { definition: string; enabled: number };
type RunRow = Omit<AutomationRunDoc, "input" | "result"> & { input: string; result: string | null };
const parseRule = (row: RuleRow): AutomationDoc => ({ ...row, enabled: Boolean(row.enabled), definition: automationSchema.parse(JSON.parse(row.definition)) });
const parseRun = (row: RunRow): AutomationRunDoc => ({ ...row, input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null });
function localDate(now: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}
function nextWeekday(date: string, weekday: number, includeToday: boolean): string {
  const current = new Date(date + "T12:00:00Z").getUTCDay();
  let offset = (weekday - current + 7) % 7;
  if (!includeToday && offset === 0) offset = 7;
  return addDays(date, offset);
}
const activeWorkspace = (id: string) => data.workspaces.some(w => w._id === id && !w.archived);
function activeItem(item: ItemView): boolean {
  return !item.archived && activeWorkspace(item.workspaceId) && (!item.areaId || data.areas.some(a => a._id === item.areaId && a.workspaceId === item.workspaceId && !a.archived));
}
function matches(item: ItemView | null, definition: AutomationDefinition, progress?: HabitTargetEvent): boolean {
  const c = definition.conditions;
  if (progress) {
    const entity = progress.kind === "habit_target_met" ? data.habits.find(h => h._id === progress.entityId && h.workspaceId === progress.workspaceId) : data.goals.find(g => g._id === progress.entityId && g.workspaceId === progress.workspaceId);
    return !!entity && (!definition.trigger.entityId || definition.trigger.entityId === entity._id) && (!c.areaId || c.areaId === entity.areaId) && !c.type && !c.status && !c.tags.length;
  }
  if (!item) return !c.areaId && !c.type && !c.status && c.tags.length === 0;
  return (!c.areaId || c.areaId === item.areaId) && (!c.type || c.type === item.type) && (!c.status || c.status === item.status) && c.tags.every(tag => item.tags.some(t => t.toLowerCase() === tag.toLowerCase()));
}
function substitute(text: string, input: AutomationInput): string {
  return text.replace(/\{\{(title|date|status)\}\}/g, (_, key: string) => key === "date" ? input.date : key === "title" ? input.item?.title ?? input.progress?.title ?? "Workspace" : input.item?.status ?? "");
}
function describe(definition: AutomationDefinition): string {
  const trigger = { schedule: `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][definition.trigger.weekday]} (${definition.trigger.timezone})`, item_created: "When an item is created", status_changed: "When a task status changes", due_date: "When an item is due", inactivity: `After ${definition.trigger.days} days without family activity`, habit_target_met: "When a habit's daily target is met", goal_target_reached: "When a goal target is reached" }[definition.trigger.kind];
  const conditions = [definition.conditions.type, definition.conditions.status, ...definition.conditions.tags.map(t => `#${t}`), definition.conditions.areaId ? "selected area" : null].filter(Boolean).join(", ");
  const action = { create_item: `create ${definition.action.type.toLowerCase()} “${definition.action.title}”`, reminder: `add reminder “${definition.action.title}”`, apply_template: `apply template ${definition.action.templateId}`, update_item: "update the matching item's allowed fields" }[definition.action.kind];
  return `${trigger}${conditions ? ` matching ${conditions}` : ""}, ${action}.`;
}
export function automationRecipes(timezone = "UTC"): AutomationDefinition[] {
  return [
    automationSchema.parse({ name: "Friday weekly review", trigger: { kind: "schedule", weekday: 5, timezone }, action: { kind: "apply_template", templateId: "starter:weekly" } }),
    automationSchema.parse({ name: "Delivery → payment follow-up", trigger: { kind: "status_changed", timezone }, conditions: { type: "Task", status: "Done", tags: ["delivery"] }, action: { kind: "create_item", title: "Follow up on payment: {{title}}", dueOffset: 3, tags: ["waiting", "client"], description: "Created because the delivery task was completed. Confirm payment before marking an Income as Received." } }),
    automationSchema.parse({ name: "Inactive project checkpoint", trigger: { kind: "inactivity", days: 14, timezone }, conditions: { tags: ["project"] }, action: { kind: "reminder", title: "Save a checkpoint: {{title}}", description: "What changed? What failed? What is the exact next action?", tags: ["waiting", "checkpoint"] } }),
  ];
}

export function createAutomations(deps: Dependencies) {
  const list = (args: { workspaceId: string }) => data.automations.filter(a => a.workspaceId === args.workspaceId);
  const runs = (args: { workspaceId: string; automationId?: string }) => data.automationRuns.filter(r => r.workspaceId === args.workspaceId && (!args.automationId || r.automationId === args.automationId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  const recipes = (args: { workspaceId: string; timezone?: string }) => { requireWorkspace(args.workspaceId); return automationRecipes(args.timezone ?? "UTC"); };
  const preview = (args: { workspaceId: Id<"workspaces">; definition: AutomationDefinition; itemId?: string; now?: number }) => {
    requireWorkspace(args.workspaceId);
    const definition = automationSchema.parse(args.definition);
    const item = args.itemId ? data.items.find(i => i._id === args.itemId && i.workspaceId === args.workspaceId) ?? null : null;
    if (args.itemId && (!item || !activeItem(item))) throw new Error("Choose an active item in this Workspace.");
    const date = localDate(args.now ?? Date.now(), definition.trigger.timezone);
    const progressKind = definition.trigger.kind === "habit_target_met" || definition.trigger.kind === "goal_target_reached" ? definition.trigger.kind : null;
    const entity = progressKind === "habit_target_met" ? data.habits.find(h => h.workspaceId === args.workspaceId && (definition.trigger.entityId ? h._id === definition.trigger.entityId : h.state === "active")) : progressKind === "goal_target_reached" ? data.goals.find(g => g.workspaceId === args.workspaceId && (definition.trigger.entityId ? g._id === definition.trigger.entityId : g.state === "active")) : undefined;
    const progress: HabitTargetEvent | undefined = progressKind && entity ? { workspaceId: args.workspaceId, kind: progressKind, entityId: entity._id, title: entity.title, date, activityId: "preview", itemId: null, value: 1, target: 1 } : undefined;
    const input: AutomationInput = { definition, date, item, explanation: describe(definition), ...(progress ? { progress } : {}) };
    const eligible = progressKind ? !!progress && matches(null, definition, progress) : matches(item, definition);
    const result = definition.action.kind === "apply_template" ? previewTemplate({ workspaceId: args.workspaceId, templateId: definition.action.templateId, startDate: date, areaId: item?.areaId ?? null, variables: Object.fromEntries(Object.entries(definition.action.variables).map(([k, v]) => [k, substitute(v, input)])) }).items.map(i => i.title) : [substitute(definition.action.title, input)];
    return { explanation: describe(definition), matches: eligible, output: result, sample: progress?.title ?? item?.title ?? "Workspace" };
  };
  const save = async (args: { workspaceId: Id<"workspaces">; automationId?: string; definition: AutomationDefinition; enabled?: boolean }) => {
    requireWorkspace(args.workspaceId);
    const definition = automationSchema.parse(args.definition);
    const progressRule = definition.trigger.kind === "habit_target_met" || definition.trigger.kind === "goal_target_reached";
    if (progressRule && (definition.conditions.type || definition.conditions.status || definition.conditions.tags.length)) throw new Error("Habit and goal triggers support an area condition, not item type, status, or tags.");
    if (progressRule && definition.action.kind === "update_item") throw new Error("Habit and goal triggers cannot update an item.");
    if (progressRule && definition.trigger.entityId && !(definition.trigger.kind === "habit_target_met" ? data.habits.some(h => h._id === definition.trigger.entityId && h.workspaceId === args.workspaceId) : data.goals.some(g => g._id === definition.trigger.entityId && g.workspaceId === args.workspaceId))) throw new Error("Choose a habit or goal in this Workspace.");
    if (definition.conditions.areaId && !data.areas.some(a => a._id === definition.conditions.areaId && a.workspaceId === args.workspaceId && !a.archived)) throw new Error("Choose an active area in this Workspace.");
    if (definition.trigger.kind === "schedule" && (definition.conditions.areaId || definition.conditions.type || definition.conditions.status || definition.conditions.tags.length)) throw new Error("Scheduled rules run once per Workspace and cannot filter a source item.");
    if (definition.action.kind === "update_item" && definition.trigger.kind === "schedule") throw new Error("A scheduled rule has no source item to update.");
    const existing = args.automationId ? list({ workspaceId: args.workspaceId }).find(a => a._id === args.automationId) : undefined;
    if (args.automationId && !existing) throw new Error("Automation not found in this Workspace.");
    if (!existing && list({ workspaceId: args.workspaceId }).length >= 100) throw new Error("A Workspace can have at most 100 automations.");
    const id = existing?._id ?? nanoid();
    const enabled = args.enabled ?? existing?.enabled ?? false;
    const now = Date.now();
    const next = definition.trigger.kind === "schedule" ? nextWeekday(localDate(now, definition.trigger.timezone), definition.trigger.weekday, true) : null;
    await run("INSERT INTO automations (_id,workspaceId,name,enabled,definition,nextRunDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(_id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,definition=excluded.definition,nextRunDate=excluded.nextRunDate,updatedAt=excluded.updatedAt", [id, args.workspaceId, definition.name, enabled ? 1 : 0, JSON.stringify(definition), next, now, now]);
    if (existing) await run("UPDATE automationRuns SET status='cancelled',error='Rule edited; queued work was cancelled.',updatedAt=? WHERE automationId=? AND status='pending'", [now, id]);
    return id;
  };
  const setEnabled = async (args: { workspaceId: Id<"workspaces">; automationId: string; enabled: boolean }) => {
    requireWorkspace(args.workspaceId);
    const rule = list(args).find(a => a._id === args.automationId);
    if (!rule) throw new Error("Automation not found in this Workspace.");
    const now = Date.now();
    const next = rule.definition.trigger.kind === "schedule" ? nextWeekday(localDate(now, rule.definition.trigger.timezone), rule.definition.trigger.weekday, true) : null;
    await run("UPDATE automations SET enabled=?,nextRunDate=?,updatedAt=? WHERE _id=? AND workspaceId=?", [args.enabled ? 1 : 0, next, now, rule._id, args.workspaceId]);
    if (!args.enabled) await run("UPDATE automationRuns SET status='cancelled',error='Rule paused.',updatedAt=? WHERE automationId=? AND status='pending'", [now, rule._id]);
    return null;
  };
  const remove = async (args: { workspaceId: Id<"workspaces">; automationId: string }) => {
    requireWorkspace(args.workspaceId);
    if (!list(args).some(a => a._id === args.automationId)) throw new Error("Automation not found in this Workspace.");
    await run("UPDATE automationRuns SET status='cancelled',error='Rule deleted.',updatedAt=? WHERE automationId=? AND status='pending'", [Date.now(), args.automationId]);
    await run("DELETE FROM automations WHERE _id=? AND workspaceId=?", [args.automationId, args.workspaceId]);
    return null;
  };
  const retry = async (args: { workspaceId: Id<"workspaces">; runId: string }) => {
    requireWorkspace(args.workspaceId);
    const [job] = await select<RunRow>("SELECT * FROM automationRuns WHERE _id=? AND workspaceId=? AND status='failed'", [args.runId, args.workspaceId]);
    if (!job) throw new Error("Choose a failed automation run.");
    const [rule] = await select<RuleRow>("SELECT * FROM automations WHERE _id=? AND workspaceId=? AND enabled=1", [job.automationId, args.workspaceId]);
    if (!rule) throw new Error("Enable the automation before retrying.");
    await run("UPDATE automationRuns SET status='pending',attempts=0,nextAttempt=?,error=NULL,updatedAt=? WHERE _id=?", [Date.now(), Date.now(), args.runId]);
    return null;
  };
  const checkpoint = async (args: { workspaceId: Id<"workspaces">; itemId: Id<"items">; did: string; failed?: string; next: string }) => {
    requireWorkspace(args.workspaceId);
    const root = data.items.find(i => i._id === args.itemId && i.workspaceId === args.workspaceId && !i.parentId && activeItem(i));
    if (!root) throw new Error("Choose an active top-level Item family in this Workspace.");
    const did = z.string().trim().min(1).max(5000).parse(args.did);
    const failed = z.string().trim().max(5000).parse(args.failed ?? "");
    const next = z.string().trim().min(1).max(5000).parse(args.next);
    return deps.createItem({ workspaceId: args.workspaceId, title: `Checkpoint: ${root.title}`.slice(0, 200), areaId: root.areaId, parentId: root._id, type: "Note", status: null, priority: null, amount: null, financialState: null, dueDate: null, tags: ["checkpoint"], description: `What changed\n${did}\n\nWhat failed\n${failed || "No failure recorded."}\n\nNext action\n${next}` }, { origin: "checkpoint", sourceId: root._id });
  };
  const enqueue = async (rule: AutomationDoc, eventKey: string, item: ItemView | null, date: string, now: number, event?: AutomationInput["event"], progress?: HabitTargetEvent) => {
    if (!activeWorkspace(rule.workspaceId) || (item && (!activeItem(item) || item.workspaceId !== rule.workspaceId)) || !matches(item, rule.definition, progress)) return;
    const input: AutomationInput = { definition: rule.definition, item, date, explanation: describe(rule.definition), ...(event ? { event } : {}), ...(progress ? { progress } : {}) };
    await run("INSERT OR IGNORE INTO automationRuns (_id,workspaceId,automationId,eventKey,status,attempts,nextAttempt,input,createdAt,updatedAt) VALUES (?,?,?,?,'pending',0,?,?,?,?)", [nanoid(), rule.workspaceId, rule._id, eventKey, now, JSON.stringify(input), now, now]);
  };
  // Only the first qualifying completion for a habit/day or goal/target queues each rule.
  const onTargetReached = async (progress: HabitTargetEvent) => {
    const rows = await select<RuleRow>("SELECT * FROM automations WHERE workspaceId=? AND enabled=1", [progress.workspaceId]);
    const key = progress.kind === "habit_target_met" ? `${progress.kind}:${progress.entityId}:${progress.date}` : `${progress.kind}:${progress.entityId}:${progress.target}`;
    for (const row of rows) {
      const rule = parseRule(row);
      if (rule.definition.trigger.kind === progress.kind) await enqueue(rule, key, null, progress.date, Date.now(), undefined, progress);
    }
  };
  // Called inside the existing transaction/savepoint, after the item and tags are written.
  const itemChanged = async (itemId: string, created: boolean, previousStatus?: ItemView["status"], provenance: ItemProvenance = { origin: "user" }, now = Date.now()) => {
    const item = await readItem(itemId);
    if (!item) return;
    const statusChanged = !created && item.type === "Task" && (previousStatus ?? null) !== (item.status ?? null);
    if (!created && !statusChanged) return;
    const eventKey = created ? `created:${item._id}` : `status:${item._id}:${nanoid()}`;
    await run("INSERT OR IGNORE INTO itemMutationEvents (_id,workspaceId,itemId,kind,origin,sourceId,createdAt) VALUES (?,?,?,?,?,?,?)", [eventKey, item.workspaceId, item._id, created ? "item_created" : "status_changed", provenance.origin, provenance.sourceId ?? null, now]);
    if (provenance.origin === "automation" || !activeItem(item)) return;
    const rows = await select<RuleRow>("SELECT * FROM automations WHERE workspaceId=? AND enabled=1", [item.workspaceId]);
    for (const row of rows) {
      const rule = parseRule(row);
      if (rule.definition.trigger.kind === (created ? "item_created" : "status_changed")) {
        await enqueue(rule, eventKey, item, localDate(now, rule.definition.trigger.timezone), now, { id: eventKey, ...provenance });
      }
    }
  };
  const execute = async (job: AutomationRunDoc, source: ItemView | null) => {
    const input = { ...job.input, item: source ?? job.input.item };
    const action = input.definition.action;
    const provenance: ItemProvenance = { origin: "automation", sourceId: job._id };
    if (action.kind === "apply_template") {
      const itemId = await deps.applyTemplate({ workspaceId: job.workspaceId as Id<"workspaces">, templateId: action.templateId, startDate: input.date, areaId: source?.areaId ?? null, variables: Object.fromEntries(Object.entries(action.variables).map(([k, v]) => [k, substitute(v, input)])) }, provenance);
      return { itemId, message: "Template applied." };
    }
    if (action.kind === "update_item") {
      if (!source) throw new Error("This action needs a source item.");
      if (action.status && source.type !== "Task") throw new Error("Only Task status can be updated.");
      await deps.updateItem({ itemId: source._id, title: source.title, type: source.type ?? null, status: action.status ?? source.status ?? null, areaId: source.areaId, parentId: source.parentId, priority: action.priority ?? source.priority ?? null, dueDate: addDays(input.date, action.dueOffset), description: source.description ?? null, amount: source.amount ?? null, financialState: source.financialState ?? null, tags: [...source.tags] }, provenance);
      return { itemId: source._id, message: "Allowed item fields updated." };
    }
    const title = substitute(action.title, input);
    if (!title.trim() || title.length > 200) throw new Error("Generated title must contain 1–200 characters.");
    const itemId = await deps.createItem({ workspaceId: job.workspaceId as Id<"workspaces">, title, type: action.kind === "reminder" ? "Note" : action.type, areaId: source?.areaId ?? null, parentId: null, status: action.kind === "reminder" || action.type !== "Task" ? null : "Todo", priority: action.priority, dueDate: addDays(input.date, action.dueOffset), description: `${substitute(action.description, input)}\n\nAutomation: ${input.definition.name}\nReason: ${input.explanation}${source ? `\nSource item: ${source._id}` : ""}`.trim(), tags: action.tags, amount: null, financialState: null }, provenance);
    return { itemId, message: action.kind === "reminder" ? "In-app reminder added." : "Item created." };
  };
  const tick = async ({ now = Date.now() }: { now?: number } = {}) => {
    let queued = 0; let completed = 0; let failed = 0;
    const rules = (await select<RuleRow>("SELECT * FROM automations WHERE enabled=1 ORDER BY createdAt")).map(parseRule);
    const generated = new Set((await select<{ itemId: string }>("SELECT itemId FROM itemMutationEvents WHERE origin='automation' AND kind='item_created'")).map(e => e.itemId));
    for (const rule of rules) {
      if (!activeWorkspace(rule.workspaceId)) continue;
      const trigger = rule.definition.trigger;
      const today = localDate(now, trigger.timezone);
      if (trigger.kind === "schedule" && rule.nextRunDate && rule.nextRunDate <= today) {
        await enqueue(rule, `schedule:${rule.nextRunDate}`, null, today, now); queued++;
        await run("UPDATE automations SET nextRunDate=? WHERE _id=?", [nextWeekday(today, trigger.weekday, false), rule._id]);
      } else if (trigger.kind === "due_date" || trigger.kind === "inactivity") {
        const candidates = data.items.filter(item => item.workspaceId === rule.workspaceId && !generated.has(item._id) && activeItem(item) && item.status !== "Done" && (trigger.kind !== "inactivity" || !item.parentId));
        for (const item of candidates) {
          if (trigger.kind === "due_date") {
            if (item.dueDate && item.dueDate <= today) { await enqueue(rule, `due:${item._id}:${item.dueDate}`, item, today, now); queued++; }
          } else {
            const activity = Math.max(item.updatedAt, ...data.items.filter(child => child.parentId === item._id && !child.archived).map(child => child.updatedAt));
            if (now - activity >= trigger.days * 86400000) { await enqueue(rule, `inactive:${item._id}:${activity}`, item, today, now); queued++; }
          }
        }
      }
    }
    const pending = await select<RunRow>("SELECT * FROM automationRuns WHERE status='pending' AND nextAttempt<=? ORDER BY createdAt LIMIT 50", [now]);
    for (const row of pending) {
      const job = parseRun(row);
      const [currentRule] = await select<RuleRow>("SELECT * FROM automations WHERE _id=? AND workspaceId=? AND enabled=1", [job.automationId, job.workspaceId]);
      const source = job.input.item ? await readItem(job.input.item._id) : null;
      if (!currentRule || !activeWorkspace(job.workspaceId) || (job.input.item && (!source || source.workspaceId !== job.workspaceId || !activeItem(source) || !matches(source, job.input.definition)))) {
        await run("UPDATE automationRuns SET status='cancelled',error='Source or rule is no longer active/matching.',updatedAt=? WHERE _id=?", [now, job._id]); continue;
      }
      await run("SAVEPOINT automation_job");
      try {
        if (job.input.progress) {
          const p = job.input.progress;
          const entity = p.kind === "habit_target_met" ? data.habits.find(h => h._id === p.entityId && h.workspaceId === p.workspaceId) : data.goals.find(g => g._id === p.entityId && g.workspaceId === p.workspaceId);
          const current = entity && entity.state === "active" ? (p.kind === "habit_target_met" ? habitDetails({ workspaceId: p.workspaceId as Id<"workspaces">, habitId: p.entityId, date: p.date }) : goalDetails({ workspaceId: p.workspaceId as Id<"workspaces">, goalId: p.entityId })) : null;
          const value = current && "todayValue" in current ? current.todayValue : current && "current" in current ? current.current : -1;
          const target = current && "todayTarget" in current ? current.todayTarget : current && "goal" in current ? current.goal.target : -1;
          if (value < p.target || target !== p.target || !matches(null, job.input.definition, p)) { await run("UPDATE automationRuns SET status='cancelled',error='Target is no longer met or active.',updatedAt=? WHERE _id=?", [now, job._id]); await run("RELEASE SAVEPOINT automation_job"); continue; }
        }
        const result = await execute(job, source);
        await run("UPDATE automationRuns SET status='completed',attempts=attempts+1,result=?,error=NULL,updatedAt=? WHERE _id=?", [JSON.stringify(result), now, job._id]);
        await run("RELEASE SAVEPOINT automation_job"); completed++;
      } catch (error) {
        await run("ROLLBACK TO SAVEPOINT automation_job");
        await run("RELEASE SAVEPOINT automation_job");
        const attempts = job.attempts + 1;
        await run("UPDATE automationRuns SET status=?,attempts=?,nextAttempt=?,error=?,updatedAt=? WHERE _id=?", [attempts >= 3 ? "failed" : "pending", attempts, now + 60000 * 2 ** (attempts - 1), (error instanceof Error ? error.message : "Action failed.").slice(0, 2000), now, job._id]); failed++;
      }
    }
    return { queued, completed, failed };
  };
  return { list, runs, recipes, preview, save, setEnabled, remove, retry, checkpoint, itemChanged, onTargetReached, tick };
}
