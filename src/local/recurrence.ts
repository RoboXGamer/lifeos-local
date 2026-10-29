import { nanoid } from "nanoid";
import { z } from "zod";
import { run, select } from "./db";
import { data } from "./store";
import { addDays, dateOnly, requireWorkspace, type CreateItem } from "./templates";
import type { Id, ItemView } from "./types";

export const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "weekdays", "interval"]),
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  mode: z.enum(["calendar", "completion"]).default("calendar"),
  startDate: z.string(),
  endDate: z.string().nullable().default(null),
  timezone: z.string().min(1).max(100),
});
export type RecurrenceDefinition = z.infer<typeof recurrenceSchema>;
export interface ScheduleDoc {
  _id: string; workspaceId: string; sourceItemId: string;
  definition: RecurrenceDefinition; nextDate: string | null;
  state: "active" | "paused" | "ended"; lastError: string | null;
  createdAt: number; updatedAt: number;
}
export interface OccurrenceDoc {
  _id: string; workspaceId: string; scheduleId: string; itemId: string;
  scheduledDate: string; state: "pending" | "done" | "skipped" | "missing";
  completedAt: number | null; createdAt: number;
}
type ScheduleRow = Omit<ScheduleDoc, "definition"> & { definition: string };
const mapSchedule = (row: ScheduleRow): ScheduleDoc => ({ ...row, definition: recurrenceSchema.parse(JSON.parse(row.definition)) });

export function zonedDate(now: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}-${parts.find(p => p.type === "day")!.value}`;
}
function validateDefinition(input: RecurrenceDefinition): RecurrenceDefinition {
  const definition = recurrenceSchema.parse(input);
  dateOnly(definition.startDate);
  if (definition.endDate) { dateOnly(definition.endDate); if (definition.endDate < definition.startDate) throw new Error("The end date must follow the start date."); }
  try { zonedDate(Date.now(), definition.timezone); } catch { throw new Error("Choose a valid timezone."); }
  definition.weekdays = [...new Set(definition.weekdays)].sort();
  if (definition.frequency === "weekdays" && !definition.weekdays.length) throw new Error("Choose at least one weekday.");
  return definition;
}
function weekday(date: string): number { return new Date(date + "T12:00:00Z").getUTCDay(); }
function monthsBetween(first: string, second: string): number { return (Number(second.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(second.slice(5, 7)) - Number(first.slice(5, 7)); }
function monthOccurrence(anchor: string, months: number, day = Number(anchor.slice(8, 10))): string {
  const month = new Date(anchor + "T12:00:00Z");
  month.setUTCDate(1); month.setUTCMonth(month.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 12)).getUTCDate();
  month.setUTCDate(Math.min(day, lastDay));
  return month.toISOString().slice(0, 10);
}
/** First scheduled date strictly after a date. Monthly dates keep the original day after a short month. */
export function nextRecurrenceDate(definition: RecurrenceDefinition, after: string): string {
  dateOnly(after);
  if (definition.frequency === "monthly") {
    if (definition.mode === "completion") return monthOccurrence(after, definition.interval);
    let months = Math.max(0, Math.floor(monthsBetween(definition.startDate, after) / definition.interval) * definition.interval);
    let next = monthOccurrence(definition.startDate, months);
    if (next <= after) next = monthOccurrence(definition.startDate, months += definition.interval);
    return next;
  }
  if (definition.frequency === "weekdays") {
    let next = addDays(after, 1);
    while (!definition.weekdays.includes(weekday(next))) next = addDays(next, 1);
    return next;
  }
  const step = definition.frequency === "weekly" ? definition.interval * 7 : definition.frequency === "interval" ? definition.interval : 1;
  if (definition.mode === "completion") return addDays(after, step);
  const elapsed = Math.floor((Date.parse(after) - Date.parse(definition.startDate)) / 86400000);
  return addDays(definition.startDate, Math.max(0, Math.floor(elapsed / step) + 1) * step);
}
function firstDate(definition: RecurrenceDefinition): string {
  return definition.frequency !== "weekdays" || definition.weekdays.includes(weekday(definition.startDate)) ? definition.startDate : nextRecurrenceDate(definition, addDays(definition.startDate, -1));
}
/** Coalesce missed dates to the latest scheduled date at or before today. */
function latestDue(definition: RecurrenceDefinition, first: string, today: string): string {
  if (definition.frequency === "monthly") {
    const months = Math.max(0, Math.floor(monthsBetween(definition.startDate, today) / definition.interval) * definition.interval);
    const candidate = monthOccurrence(definition.startDate, months);
    return candidate <= today ? candidate : monthOccurrence(definition.startDate, Math.max(0, months - definition.interval));
  }
  if (definition.frequency === "weekdays") {
    let date = today;
    while (!definition.weekdays.includes(weekday(date))) date = addDays(date, -1);
    return date < first ? first : date;
  }
  const step = definition.frequency === "weekly" ? definition.interval * 7 : definition.frequency === "interval" ? definition.interval : 1;
  const elapsed = Math.floor((Date.parse(today) - Date.parse(first)) / 86400000);
  return addDays(first, Math.floor(elapsed / step) * step);
}
export function listSchedules(args: { workspaceId: string }): ScheduleDoc[] { return data.schedules.filter(s => s.workspaceId === args.workspaceId); }
export function listOccurrences(args: { workspaceId: string; scheduleId?: string }): OccurrenceDoc[] {
  return data.occurrences.filter(o => o.workspaceId === args.workspaceId && (!args.scheduleId || o.scheduleId === args.scheduleId)).toSorted((a, b) => b.createdAt - a.createdAt);
}
export function scheduleForItem(itemId: string): ScheduleDoc | undefined {
  const occurrence = data.occurrences.find(o => o.itemId === itemId);
  return data.schedules.find(s => s.sourceItemId === itemId || s._id === occurrence?.scheduleId);
}
export function recurrenceLabel(definition: RecurrenceDefinition): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const frequency = definition.frequency === "weekdays" ? definition.weekdays.map(d => days[d]).join(", ") : definition.frequency === "interval" ? `Every ${definition.interval} days` : definition.frequency === "daily" ? "Daily" : `Every ${definition.interval} ${definition.frequency === "weekly" ? "week(s)" : "month(s)"}`;
  return `${frequency}${definition.mode === "completion" ? " after completion" : " on the calendar"}`;
}
function isComplete(item: ItemView): boolean {
  return item.type === "Task" ? item.status === "Done" : item.type === "Expense" ? item.financialState === "Spent" : item.type === "Income" ? item.financialState === "Received" : false;
}
async function readItem(itemId: string): Promise<ItemView | undefined> {
  const [item] = await select<ItemView>("SELECT * FROM items WHERE _id=?", [itemId]);
  if (!item) return undefined;
  const tags = await select<{ name: string }>("SELECT tags.name FROM tags JOIN itemTags ON itemTags.tagId=tags._id WHERE itemTags.itemId=?", [itemId]);
  return { ...item, tags: tags.map(t => t.name) };
}
async function readSchedule(workspaceId: string, scheduleId: string): Promise<ScheduleDoc> {
  const [row] = await select<ScheduleRow>("SELECT * FROM recurrenceSchedules WHERE _id=? AND workspaceId=?", [scheduleId, workspaceId]);
  if (!row) throw new Error("Recurring schedule not found in this Workspace.");
  return mapSchedule(row);
}

export function createRecurrence(createItem: CreateItem) {
  const save = async (args: { workspaceId: Id<"workspaces">; itemId: Id<"items">; scheduleId?: string; definition: RecurrenceDefinition }) => {
    requireWorkspace(args.workspaceId);
    const definition = validateDefinition(args.definition);
    const existing = args.scheduleId ? await readSchedule(args.workspaceId, args.scheduleId) : (await select<ScheduleRow>("SELECT * FROM recurrenceSchedules WHERE workspaceId=? AND sourceItemId=?", [args.workspaceId, args.itemId])).map(mapSchedule)[0];
    const item = await readItem(existing?.sourceItemId ?? args.itemId);
    if (!item || item.workspaceId !== args.workspaceId || item.archived || !["Task", "Expense", "Income"].includes(item.type ?? "")) throw new Error("Repeat an active Task, Expense, or Income item.");
    const now = Date.now(); const today = zonedDate(now, definition.timezone);
    const id = existing?._id ?? nanoid();
    let nextDate: string | null = firstDate(definition);
    if (existing) {
      const [pending] = await select<OccurrenceDoc>("SELECT * FROM recurrenceOccurrences WHERE scheduleId=? AND state='pending'", [id]);
      if (pending) nextDate = definition.mode === "completion" ? null : nextRecurrenceDate(definition, pending.scheduledDate);
    } else {
      const pending = !isComplete(item);
      const occurrenceDate = pending ? firstDate(definition) : item.dueDate ? dateOnly(item.dueDate) : today;
      await run("INSERT INTO recurrenceOccurrences (_id, workspaceId, scheduleId, itemId, scheduledDate, state, completedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [nanoid(), args.workspaceId, id, item._id, occurrenceDate, pending ? "pending" : "done", pending ? null : now, now]);
      if (pending) {
        await run("UPDATE items SET dueDate=?, updatedAt=? WHERE _id=?", [occurrenceDate, now, item._id]);
        nextDate = definition.mode === "completion" ? null : nextRecurrenceDate(definition, occurrenceDate);
      } else if (definition.mode === "completion") nextDate = nextRecurrenceDate(definition, today);
      else if (nextDate <= today || nextDate <= occurrenceDate) nextDate = nextRecurrenceDate(definition, today > occurrenceDate ? today : occurrenceDate);
    }
    if (definition.endDate && nextDate && nextDate > definition.endDate) nextDate = null;
    await run("INSERT INTO recurrenceSchedules (_id, workspaceId, sourceItemId, definition, nextDate, state, lastError, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?) ON CONFLICT(_id) DO UPDATE SET definition=excluded.definition, nextDate=excluded.nextDate, state='active', lastError=NULL, updatedAt=excluded.updatedAt", [id, args.workspaceId, item._id, JSON.stringify(definition), nextDate, now, now]);
    return id;
  };

  const tick = async (args: { now?: number } = {}) => {
    const now = args.now ?? Date.now();
    let changes = 0;
    const schedules = (await select<ScheduleRow>("SELECT * FROM recurrenceSchedules WHERE state='active'")).map(mapSchedule);
    for (const schedule of schedules) {
      const definition = schedule.definition;
      const today = zonedDate(now, definition.timezone);
      const [workspace] = await select<{ _id: string }>("SELECT _id FROM workspaces WHERE _id=? AND archived=0", [schedule.workspaceId]);
      const source = await readItem(schedule.sourceItemId);
      const [sourceSkipped] = await select<{ _id: string }>("SELECT _id FROM recurrenceOccurrences WHERE scheduleId=? AND itemId=? AND state='skipped'", [schedule._id, schedule.sourceItemId]);
      const [pending] = await select<OccurrenceDoc>("SELECT * FROM recurrenceOccurrences WHERE scheduleId=? AND state='pending'", [schedule._id]);
      const current = pending ? await readItem(pending.itemId) : undefined;
      const area = source?.areaId ? (await select<{ _id: string }>("SELECT _id FROM areas WHERE _id=? AND workspaceId=? AND archived=0", [source.areaId, schedule.workspaceId]))[0] : true;
      if (!workspace || !source || (source.archived && !sourceSkipped) || !["Task", "Expense", "Income"].includes(source.type ?? "") || !area || (pending && (!current || current.archived))) {
        if (pending && !current) await run("UPDATE recurrenceOccurrences SET state='missing', completedAt=? WHERE _id=?", [now, pending._id]);
        await run("UPDATE recurrenceSchedules SET state='paused', lastError=?, updatedAt=? WHERE _id=?", ["Source, occurrence, Workspace, or Area is archived or missing. Restore it and resume to continue.", now, schedule._id]);
        changes++; continue;
      }
      if (pending && current && !isComplete(current)) continue;
      let nextDate = schedule.nextDate;
      if (pending) {
        await run("UPDATE recurrenceOccurrences SET state='done', completedAt=? WHERE _id=?", [now, pending._id]);
        changes++;
        if (definition.mode === "completion") nextDate = nextRecurrenceDate(definition, today);
        await run("UPDATE recurrenceSchedules SET nextDate=?, updatedAt=? WHERE _id=?", [nextDate, now, schedule._id]);
      }
      if (definition.endDate && nextDate && nextDate > definition.endDate) nextDate = null;
      if (!nextDate) {
        await run("UPDATE recurrenceSchedules SET state='ended', nextDate=NULL, updatedAt=? WHERE _id=?", [now, schedule._id]); changes++; continue;
      }
      if (nextDate > today) continue;
      // Completion-based repetition counts from completion, rather than the original calendar anchor.
      const due = definition.mode === "completion" ? nextDate : latestDue(definition, nextDate, definition.endDate && definition.endDate < today ? definition.endDate : today);
      const [duplicate] = await select<{ _id: string }>("SELECT _id FROM recurrenceOccurrences WHERE scheduleId=? AND scheduledDate=?", [schedule._id, due]);
      if (duplicate) {
        await run("UPDATE recurrenceSchedules SET nextDate=?, updatedAt=? WHERE _id=?", [nextRecurrenceDate(definition, due), now, schedule._id]); changes++; continue;
      }
      await run("SAVEPOINT recurrence_occurrence");
      try {
        const id = await createItem({ workspaceId: schedule.workspaceId as Id<"workspaces">, title: source.title, type: source.type ?? "Task", description: source.description ?? null, areaId: source.areaId, parentId: source.parentId, tags: [...source.tags], priority: source.priority ?? null, dueDate: due, amount: source.amount ?? null, status: source.type === "Task" ? "Todo" : null, financialState: source.type === "Income" ? "Expected" : source.type === "Expense" ? "Planned" : null });
        await run("INSERT INTO recurrenceOccurrences (_id, workspaceId, scheduleId, itemId, scheduledDate, state, createdAt) VALUES (?, ?, ?, ?, ?, 'pending', ?)", [nanoid(), schedule.workspaceId, schedule._id, id, due, now]);
        const following = definition.mode === "completion" ? null : nextRecurrenceDate(definition, due);
        await run("UPDATE recurrenceSchedules SET nextDate=?, lastError=NULL, updatedAt=? WHERE _id=?", [following, now, schedule._id]);
        await run("RELEASE SAVEPOINT recurrence_occurrence"); changes++;
      } catch (error) {
        await run("ROLLBACK TO SAVEPOINT recurrence_occurrence"); await run("RELEASE SAVEPOINT recurrence_occurrence");
        await run("UPDATE recurrenceSchedules SET lastError=?, updatedAt=? WHERE _id=?", [error instanceof Error ? error.message : "Could not create the next occurrence.", now, schedule._id]); changes++;
      }
    }
    return changes;
  };

  const control = async (args: { workspaceId: Id<"workspaces">; scheduleId: string; action: "pause" | "resume" | "end" | "skip" | "snooze"; date?: string }) => {
    requireWorkspace(args.workspaceId);
    const schedule = await readSchedule(args.workspaceId, args.scheduleId);
    const now = Date.now();
    if (["pause", "resume", "end"].includes(args.action)) {
      if (schedule.state === "ended" && args.action !== "end") throw new Error("Save a new schedule to restart an ended recurrence.");
      await run("UPDATE recurrenceSchedules SET state=?, nextDate=CASE WHEN ?='end' THEN NULL ELSE nextDate END, lastError=NULL, updatedAt=? WHERE _id=?", [args.action === "pause" ? "paused" : args.action === "end" ? "ended" : "active", args.action, now, schedule._id]);
      if (args.action === "resume") await tick({ now });
      return null;
    }
    const [pending] = await select<OccurrenceDoc>("SELECT * FROM recurrenceOccurrences WHERE scheduleId=? AND state='pending'", [schedule._id]);
    if (args.action === "snooze") {
      const date = dateOnly(args.date ?? "");
      if (date <= zonedDate(now, schedule.definition.timezone)) throw new Error("Snooze until a future date.");
      if (schedule.definition.endDate && date > schedule.definition.endDate) throw new Error("Snooze must be before the recurrence ends.");
      if (pending) await run("UPDATE items SET dueDate=?, updatedAt=? WHERE _id=?", [date, now, pending.itemId]);
      else await run("UPDATE recurrenceSchedules SET nextDate=?, updatedAt=? WHERE _id=?", [date, now, schedule._id]);
      return null;
    }
    if (args.action !== "skip") throw new Error("Unknown recurrence action.");
    if (!pending) throw new Error("No outstanding occurrence to skip.");
    await run("UPDATE recurrenceOccurrences SET state='skipped', completedAt=? WHERE _id=?", [now, pending._id]);
    await run("UPDATE items SET archived=1, updatedAt=? WHERE workspaceId=? AND (_id=? OR parentId=?)", [now, args.workspaceId, pending.itemId, pending.itemId]);
    const next = schedule.definition.mode === "completion" ? nextRecurrenceDate(schedule.definition, zonedDate(now, schedule.definition.timezone)) : nextRecurrenceDate(schedule.definition, pending.scheduledDate);
    await run("UPDATE recurrenceSchedules SET nextDate=?, updatedAt=? WHERE _id=?", [next, now, schedule._id]);
    return null;
  };

  const afterMutation = async (name: string, _args: unknown, _result: unknown, now = Date.now()) => {
    if (name.startsWith("items.") || name.startsWith("areas.") || name.startsWith("workspaces.")) return tick({ now });
    return 0;
  };
  return { save, control, tick, afterMutation };
}
