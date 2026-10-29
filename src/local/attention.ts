import { nanoid } from "nanoid";
import { z } from "zod";
import { data } from "./store";
import { run } from "./db";
import { addDays, dateOnly, requireWorkspace } from "./templates";
import { formatMoney, obligationDetails } from "./obligations";
import type { Id, ItemView } from "./types";

export interface AttentionFeedbackDoc {
  _id: string; workspaceId: string; suggestionId: string;
  action: "dismiss" | "snooze"; note: string; untilDate: string | null;
  createdAt: number; updatedAt: number;
}
export interface ItemEstimateDoc { _id: string; workspaceId: string; itemId: string; minutes: number; updatedAt: number }
export interface AttentionSuggestion {
  _id: string; kind: "waiting" | "payment" | "decision" | "shipping" | "maintenance";
  title: string; reason: string; detail: string; itemId: string | null;
  href: string; sourceLabel: string; sourceIds: string[]; estimatedMinutes: number | null;
}
type Candidate = AttentionSuggestion & { score: number; identity: string };
function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function completed(item: ItemView): boolean {
  return item.type === "Task" && item.status === "Done" || item.type === "Expense" && item.financialState === "Spent" || item.type === "Income" && item.financialState === "Received";
}
function itemHref(itemId: string): string { return `/app/today?item=${encodeURIComponent(itemId)}&mode=view`; }
function tags(item: ItemView): string[] { return item.tags.map(t => t.toLowerCase()); }
const maintenanceTags = ["maintenance", "renewal", "renewals", "subscription", "backup", "document", "expiry"];

export function buildAttention(args: { workspaceId: Id<"workspaces">; availableMinutes?: number; date?: string }) {
  requireWorkspace(args.workspaceId);
  const today = dateOnly(args.date ?? localDate());
  const capacity = args.availableMinutes === undefined ? null : z.number().int().min(1).max(1440).parse(args.availableMinutes);
  const activeAreaIds = new Set(data.areas.filter(a => a.workspaceId === args.workspaceId && !a.archived).map(a => a._id));
  const visible = data.items.filter(i => i.workspaceId === args.workspaceId && !i.archived && (!i.areaId || activeAreaIds.has(i.areaId)));
  const open = visible.filter(i => !completed(i));
  const estimates = data.itemEstimates.filter(e => e.workspaceId === args.workspaceId);
  const estimate = (id: string) => estimates.find(e => e.itemId === id)?.minutes ?? null;
  const candidates: Candidate[] = [];
  const addItem = (item: ItemView, value: Pick<Candidate, "_id" | "kind" | "title" | "reason" | "detail" | "score">) => candidates.push({ ...value, identity: `item:${item._id}`, itemId: item._id, href: itemHref(item._id), sourceLabel: `Item: ${item.title}`, sourceIds: [item._id], estimatedMinutes: estimate(item._id) });

  for (const item of open) {
    const itemTags = tags(item);
    if (itemTags.includes("waiting")) {
      const due = !!item.dueDate && item.dueDate <= today;
      addItem(item, { _id: `waiting:${item._id}:${item.updatedAt}`, kind: "waiting", title: `Waiting: ${item.title}`, reason: due ? `Follow-up date ${item.dueDate} has arrived.` : "You tagged this item as waiting for someone else.", detail: `${item.description?.slice(0, 300) || "Record who owes the reply, approval, deliverable, or payment."} Last item update: ${new Date(item.updatedAt).toLocaleDateString()}. This is not a recorded contact time.`, score: due ? 100 : 65 });
    }
    if (itemTags.some(t => maintenanceTags.includes(t)) && item.dueDate && item.dueDate <= addDays(today, 14)) {
      addItem(item, { _id: `maintenance:${item._id}:${item.dueDate}`, kind: "maintenance", title: `Keep life running: ${item.title}`, reason: item.dueDate < today ? `Maintenance was due ${item.dueDate}.` : `Upcoming maintenance is dated ${item.dueDate}.`, detail: item.description?.slice(0, 300) || "Check the recorded renewal, backup, subscription, or document deadline.", score: item.dueDate <= today ? 105 : 60 });
    }
  }

  for (const schedule of data.schedules.filter(s => s.workspaceId === args.workspaceId && s.state === "active" && s.nextDate && s.nextDate <= addDays(today, 7))) {
    const source = visible.find(i => i._id === schedule.sourceItemId);
    if (!source || !tags(source).some(t => maintenanceTags.includes(t))) continue;
    candidates.push({ _id: `maintenance-schedule:${schedule._id}:${schedule.nextDate}`, kind: "maintenance", title: `Coming up: ${source.title}`, reason: `The recurring schedule next runs on ${schedule.nextDate}.`, detail: "A scheduled date is evidence of planned work; it does not mean the work or a payment has happened.", itemId: source._id, href: "/app/recurring", sourceLabel: `Recurring schedule: ${source.title}`, sourceIds: [schedule._id, source._id], estimatedMinutes: estimate(source._id), identity: `item:${source._id}`, score: 58 });
  }

  for (const project of data.projects.filter(p => p.workspaceId === args.workspaceId && p.status !== "archived")) {
    const root = visible.find(i => i._id === project.itemId);
    if (!root) continue;
    const checkpoint = data.projectCheckpoints.filter(c => c.projectId === project._id && c.workspaceId === args.workspaceId).toSorted((a, b) => b.createdAt - a.createdAt)[0];
    if (!checkpoint || (!checkpoint.whyStopped && !checkpoint.failed)) continue;
    candidates.push({ _id: `decision:${project._id}:${checkpoint._id}`, kind: "decision", title: `Remember why ${project.name} stopped`, reason: project.status === "paused" ? "This project is paused and has a recorded stopping reason or failed attempt." : "A previous checkpoint records a blocker worth checking before repeating the work.", detail: [checkpoint.whyStopped && `Why: ${checkpoint.whyStopped}`, checkpoint.failed && `Failed: ${checkpoint.failed}`, checkpoint.next && `Recorded next action: ${checkpoint.next}`].filter(Boolean).join("\n").slice(0, 1000), itemId: root._id, href: "/app/projects", sourceLabel: `Checkpoint: ${project.name} · ${new Date(checkpoint.createdAt).toLocaleDateString()}`, sourceIds: [project._id, checkpoint._id, checkpoint.itemId], estimatedMinutes: null, identity: `item:${root._id}`, score: project.status === "paused" ? 72 : 45 });
  }

  for (const engagement of data.engagements.filter(e => e.workspaceId === args.workspaceId)) {
    const details = obligationDetails({ workspaceId: args.workspaceId, engagementId: engagement._id });
    for (const invoice of details.invoices.filter(i => i.state === "issued" && i.dueDate && i.dueDate <= today && i.outstandingMinor > 0)) {
      const linked = data.obligationFollowups.find(f => f.workspaceId === args.workspaceId && f.engagementId === engagement._id && f.exceptionKey === `overdue:${invoice._id}`);
      candidates.push({ _id: `payment:${invoice._id}:${invoice.outstandingMinor}:${invoice.dueDate}`, kind: "payment", title: `Follow up with ${engagement.client}`, reason: `${invoice.reference} has ${formatMoney(invoice.outstandingMinor, invoice.currency)} outstanding and was due ${invoice.dueDate}.`, detail: "The balance uses recorded invoices and allocated receipts/refunds. Unrecorded payments remain unknown.", itemId: linked?.itemId ?? null, href: "/app/obligations", sourceLabel: `Invoice: ${engagement.name} / ${invoice.reference}`, sourceIds: [engagement._id, invoice._id, ...(invoice.documentId ? [invoice.documentId] : [])], estimatedMinutes: linked ? estimate(linked.itemId) : null, identity: linked ? `item:${linked.itemId}` : `invoice:${invoice._id}`, score: 120 });
    }
    for (const issue of details.exceptions.filter(e => !e.key.startsWith("overdue:"))) {
      const linked = data.obligationFollowups.find(f => f.workspaceId === args.workspaceId && f.engagementId === engagement._id && f.exceptionKey === issue.key);
      candidates.push({ _id: `obligation:${engagement._id}:${issue.key}`, kind: "payment", title: issue.title, reason: issue.detail, detail: "Review the linked source evidence before changing accepted terms or recorded money.", itemId: linked?.itemId ?? null, href: "/app/obligations", sourceLabel: `Engagement: ${engagement.client} / ${engagement.name}`, sourceIds: [engagement._id, ...issue.sourceIds], estimatedMinutes: linked ? estimate(linked.itemId) : null, identity: linked ? `item:${linked.itemId}` : `obligation:${engagement._id}:${issue.key}`, score: issue.key.startsWith("conflict:") ? 108 : 80 });
    }
  }

  const shippable = open.filter(i => {
    const parent = i.parentId ? visible.find(p => p._id === i.parentId) : undefined;
    const project = data.projects.find(p => p.workspaceId === args.workspaceId && p.itemId === (i.parentId ?? i._id));
    return i.type === "Task" && !tags(i).some(t => ["waiting", "blocked"].includes(t)) && (!parent || !tags(parent).some(t => ["waiting", "blocked"].includes(t))) && (!project || project.status === "active") && !open.some(child => child.parentId === i._id);
  });
  const fitting = capacity === null ? [] : shippable.filter(i => estimate(i._id) !== null && estimate(i._id)! <= capacity);
  const chosen = (fitting.length ? fitting : capacity === null ? shippable : shippable.filter(i => estimate(i._id) === null)).toSorted((a, b) => (a.priority ?? 3) - (b.priority ?? 3) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt - b.createdAt)[0];
  if (chosen) {
    const minutes = estimate(chosen._id);
    const fits = capacity !== null && minutes !== null && minutes <= capacity;
    addItem(chosen, { _id: `shipping:${chosen._id}:${chosen.updatedAt}:${minutes ?? "unknown"}`, kind: "shipping", title: fits ? `One shippable thing: ${chosen.title}` : `Choose a bounded next step: ${chosen.title}`, reason: fits ? `Your saved estimate is ${minutes} minutes; you have set ${capacity} available minutes. No waiting or blocked tag is recorded.` : "This is an open task without a recorded waiting/blocked tag. Its time fit is unverified.", detail: chosen.description?.slice(0, 350) || (fits ? "Use the recorded estimate as a guide and stop to reassess if a new blocker appears." : "Set your available time and an honest task estimate, or choose one small first step before committing."), score: fits ? 90 : 35 });
  }

  const feedback = data.attentionFeedback.filter(f => f.workspaceId === args.workspaceId);
  const hidden = (id: string) => feedback.some(f => f.suggestionId === id && (f.action === "dismiss" || f.action === "snooze" && !!f.untilDate && f.untilDate > today));
  const ranked = candidates.toSorted((a, b) => b.score - a.score || a._id.localeCompare(b._id));
  const identities = new Set<string>();
  const deduplicated = ranked.filter(c => { if (identities.has(c.identity)) return false; identities.add(c.identity); return true; });
  const eligible = deduplicated.filter(c => !hidden(c._id));
  const selected: Candidate[] = [];
  for (const candidate of eligible) if (selected.length < 3 && !selected.some(s => s.kind === candidate.kind)) selected.push(candidate);
  for (const candidate of eligible) if (selected.length < 3 && !selected.includes(candidate)) selected.push(candidate);
  return { suggestions: selected.map(({ score: _score, identity: _identity, ...suggestion }) => suggestion), hiddenCount: deduplicated.length - eligible.length, eligibleCount: eligible.length, availableMinutes: capacity };
}

export function createAttention() {
  const feedback = async (args: { workspaceId: Id<"workspaces">; suggestionId: string; action: "dismiss" | "snooze" | "reset"; untilDate?: string; note?: string }) => {
    requireWorkspace(args.workspaceId);
    const value = z.object({ suggestionId: z.string().min(1).max(500), action: z.enum(["dismiss", "snooze", "reset"]), note: z.string().trim().max(1000).default("") }).parse(args);
    if (value.action === "reset") { await run("DELETE FROM attentionFeedback WHERE workspaceId=? AND suggestionId=?", [args.workspaceId, value.suggestionId]); return null; }
    const untilDate = value.action === "snooze" ? dateOnly(args.untilDate ?? "") : null;
    if (untilDate && untilDate <= localDate()) throw new Error("Snooze until a future date.");
    const now = Date.now();
    await run("INSERT INTO attentionFeedback (_id,workspaceId,suggestionId,action,note,untilDate,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(workspaceId,suggestionId) DO UPDATE SET action=excluded.action,note=excluded.note,untilDate=excluded.untilDate,updatedAt=excluded.updatedAt", [nanoid(), args.workspaceId, value.suggestionId, value.action, value.note, untilDate, now, now]);
    return null;
  };
  const estimate = async (args: { workspaceId: Id<"workspaces">; itemId: Id<"items">; minutes: number | null }) => {
    requireWorkspace(args.workspaceId);
    const item = data.items.find(i => i._id === args.itemId && i.workspaceId === args.workspaceId && !i.archived);
    if (!item || item.type !== "Task") throw new Error("Choose an active Task in this Workspace.");
    if (args.minutes === null) { await run("DELETE FROM itemEstimates WHERE workspaceId=? AND itemId=?", [args.workspaceId, item._id]); return null; }
    const minutes = z.number().int().min(1).max(1440).parse(args.minutes);
    await run("INSERT INTO itemEstimates (_id,workspaceId,itemId,minutes,updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(workspaceId,itemId) DO UPDATE SET minutes=excluded.minutes,updatedAt=excluded.updatedAt", [nanoid(), args.workspaceId, item._id, minutes, Date.now()]);
    return null;
  };
  return { feedback, estimate };
}
