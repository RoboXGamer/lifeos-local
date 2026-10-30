import { createStore, reconcile as solidReconcile } from "solid-js";
import { select } from "./db";
import type { TemplateDoc } from "./templates";
import type { ScheduleDoc, OccurrenceDoc } from "./recurrence";
import type { AutomationDoc, AutomationRunDoc } from "./automations";
import type { ProjectDoc, ProjectSourceDoc, ProjectCheckpointDoc } from "./projects";
import type { EngagementDoc, ObligationDocument, CommitmentDoc, InvoiceDoc, PaymentDoc, AllocationDoc, ObligationFollowupDoc, ObligationReviewDoc } from "./obligations";
import type { AttentionFeedbackDoc, ItemEstimateDoc } from "./attention";
import type { HabitDoc, HabitVersionDoc, GoalDoc, GoalVersionDoc, ActivityDoc, HabitDayMarkDoc } from "./habits";

// The current Solid RC can leave a trailing sparse slot after keyed deletion.
// Preserve keyed identities, then explicitly synchronize the array length.
function reconcile<T extends { _id: string }>(next: T[], key: "_id") {
  const apply = solidReconcile(next, key);
  return (target: T[]) => { apply(target); target.length = next.length; };
}
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
  habits: HabitDoc[];
  habitVersions: HabitVersionDoc[];
  goals: GoalDoc[];
  goalVersions: GoalVersionDoc[];
  activities: ActivityDoc[];
  habitDayMarks: HabitDayMarkDoc[];
  attentionFeedback: AttentionFeedbackDoc[];
  itemEstimates: ItemEstimateDoc[];
  obligationFollowups: ObligationFollowupDoc[];
  obligationReviews: ObligationReviewDoc[];
  automations: AutomationDoc[];
  automationRuns: AutomationRunDoc[];
  projects: ProjectDoc[];
  projectSources: ProjectSourceDoc[];
  projectCheckpoints: ProjectCheckpointDoc[];
  engagements: EngagementDoc[];
  obligationDocuments: ObligationDocument[];
  commitments: CommitmentDoc[];
  obligationInvoices: InvoiceDoc[];
  obligationPayments: PaymentDoc[];
  paymentAllocations: AllocationDoc[];
  schedules: ScheduleDoc[];
  occurrences: OccurrenceDoc[];
  templates: TemplateDoc[];
  profile: ProfileDoc | undefined;
  workspaces: WorkspaceDoc[];
  areas: AreaDoc[];
  items: ItemView[];
  tags: TagDoc[];
  itemTags: ItemTagDoc[];
}

const emptyState: DbState = {
  habits: [], habitVersions: [], goals: [], goalVersions: [], activities: [], habitDayMarks: [],
  attentionFeedback: [], itemEstimates: [], obligationFollowups: [], obligationReviews: [],
  automations: [], automationRuns: [], projects: [], projectSources: [], projectCheckpoints: [],
  engagements: [], obligationDocuments: [], commitments: [], obligationInvoices: [], obligationPayments: [], paymentAllocations: [],
  schedules: [],
  occurrences: [],
  templates: [],
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
    reconcile(next.habits ?? [], "_id")(state.habits);
    reconcile(next.habitVersions ?? [], "_id")(state.habitVersions);
    reconcile(next.goals ?? [], "_id")(state.goals);
    reconcile(next.goalVersions ?? [], "_id")(state.goalVersions);
    reconcile(next.activities ?? [], "_id")(state.activities);
    reconcile(next.habitDayMarks ?? [], "_id")(state.habitDayMarks);
    reconcile(next.attentionFeedback ?? [], "_id")(state.attentionFeedback);
    reconcile(next.itemEstimates ?? [], "_id")(state.itemEstimates);
    reconcile(next.obligationFollowups ?? [], "_id")(state.obligationFollowups);
    reconcile(next.obligationReviews ?? [], "_id")(state.obligationReviews);
    reconcile(next.automations ?? [], "_id")(state.automations);
    reconcile(next.automationRuns ?? [], "_id")(state.automationRuns);
    reconcile(next.projects ?? [], "_id")(state.projects);
    reconcile(next.projectSources ?? [], "_id")(state.projectSources);
    reconcile(next.projectCheckpoints ?? [], "_id")(state.projectCheckpoints);
    reconcile(next.engagements ?? [], "_id")(state.engagements);
    reconcile(next.obligationDocuments ?? [], "_id")(state.obligationDocuments);
    reconcile(next.commitments ?? [], "_id")(state.commitments);
    reconcile(next.obligationInvoices ?? [], "_id")(state.obligationInvoices);
    reconcile(next.obligationPayments ?? [], "_id")(state.obligationPayments);
    reconcile(next.paymentAllocations ?? [], "_id")(state.paymentAllocations);
    reconcile(next.schedules ?? [], "_id")(state.schedules);
    reconcile(next.occurrences ?? [], "_id")(state.occurrences);
    reconcile(next.templates ?? [], "_id")(state.templates);
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
  const [habits, habitVersions, goals, goalVersions, activities, habitDayMarks, habitGoalLinks, activityGoalLinks] = await Promise.all([
    select<Row>("SELECT * FROM habits ORDER BY createdAt"), select<Row>("SELECT * FROM habitVersions ORDER BY createdAt"),
    select<Row>("SELECT * FROM goals ORDER BY createdAt"), select<Row>("SELECT * FROM goalVersions ORDER BY createdAt"),
    select<Row>("SELECT * FROM activityEntries ORDER BY createdAt"), select<Row>("SELECT * FROM habitDayMarks"),
    select<Row>("SELECT * FROM habitGoalLinks"), select<Row>("SELECT * FROM activityGoalLinks"),
  ]);
  const [attentionFeedback, itemEstimates, obligationFollowups, obligationReviews] = await Promise.all([
    select<Row>("SELECT * FROM attentionFeedback"), select<Row>("SELECT * FROM itemEstimates"), select<Row>("SELECT * FROM obligationFollowups"),
    select<Row>("SELECT * FROM obligationReviews ORDER BY createdAt"),
  ]);
  const [automations, automationRuns, projects, projectSources, projectCheckpoints, engagements, obligationDocuments, commitments, obligationInvoices, obligationPayments, paymentAllocations] = await Promise.all([
    select<Row>("SELECT * FROM automations ORDER BY createdAt"), select<Row>("SELECT * FROM automationRuns ORDER BY createdAt DESC LIMIT 1000"),
    select<Row>("SELECT * FROM projects ORDER BY createdAt"), select<Row>("SELECT * FROM projectSources ORDER BY capturedAt"), select<Row>("SELECT * FROM projectCheckpoints ORDER BY createdAt"),
    select<Row>("SELECT * FROM engagements ORDER BY createdAt"), select<Row>("SELECT * FROM obligationDocuments ORDER BY createdAt"), select<Row>("SELECT * FROM commitments ORDER BY createdAt"),
    select<Row>("SELECT * FROM obligationInvoices ORDER BY createdAt"), select<Row>("SELECT * FROM obligationPayments ORDER BY createdAt"), select<Row>("SELECT * FROM paymentAllocations"),
  ]);
  const [profiles, workspaces, areas, items, tags, itemTags, templates, schedules, occurrences] = await Promise.all([
    select<Row>("SELECT * FROM profiles LIMIT 1"),
    select<Row>("SELECT * FROM workspaces ORDER BY createdAt"),
    select<Row>("SELECT * FROM areas ORDER BY createdAt"),
    select<Row>("SELECT * FROM items ORDER BY createdAt"),
    select<Row>("SELECT * FROM tags ORDER BY normalizedName"),
    select<Row>("SELECT * FROM itemTags"),
    select<Row>("SELECT * FROM templates ORDER BY name"),
    select<Row>("SELECT * FROM recurrenceSchedules ORDER BY createdAt"),
    select<Row>("SELECT * FROM recurrenceOccurrences ORDER BY createdAt"),
  ]);

  const mappedTags = tags.map(mapTag);
  const mappedLinks = itemTags.map(mapItemTag);
  const view = attachTags(items.map(mapItem), mappedTags, mappedLinks);

  setData((state) => {
    state.profile = profiles[0] ? mapProfile(profiles[0]) : undefined;
    reconcile(habits.map(row=>({...row,goalIds:habitGoalLinks.filter(link=>link.habitId===row._id&&link.workspaceId===row.workspaceId).map(link=>String(link.goalId))})) as unknown as HabitDoc[], "_id")(state.habits);
    reconcile(habitVersions as unknown as HabitVersionDoc[], "_id")(state.habitVersions);
    reconcile(goals as unknown as GoalDoc[], "_id")(state.goals);
    reconcile(goalVersions as unknown as GoalVersionDoc[], "_id")(state.goalVersions);
    reconcile(activities.map(row=>({...row,voided:Boolean(row.voided),goalIds:activityGoalLinks.filter(link=>link.activityId===row._id&&link.workspaceId===row.workspaceId).map(link=>String(link.goalId))})) as unknown as ActivityDoc[], "_id")(state.activities);
    reconcile(habitDayMarks as unknown as HabitDayMarkDoc[], "_id")(state.habitDayMarks);
    reconcile(attentionFeedback as unknown as AttentionFeedbackDoc[], "_id")(state.attentionFeedback);
    reconcile(itemEstimates as unknown as ItemEstimateDoc[], "_id")(state.itemEstimates);
    reconcile(obligationFollowups as unknown as DbState["obligationFollowups"], "_id")(state.obligationFollowups);
    reconcile(obligationReviews as unknown as ObligationReviewDoc[], "_id")(state.obligationReviews);
    reconcile(automations.map(row => ({ ...row, enabled: Boolean(row.enabled), definition: JSON.parse(String(row.definition)) })) as unknown as AutomationDoc[], "_id")(state.automations);
    reconcile(automationRuns.map(row => ({ ...row, input: JSON.parse(String(row.input)), result: row.result ? JSON.parse(String(row.result)) : null })) as unknown as AutomationRunDoc[], "_id")(state.automationRuns);
    reconcile(projects.map(row => ({ ...row, settings: JSON.parse(String(row.settings)) })) as unknown as ProjectDoc[], "_id")(state.projects);
    reconcile(projectSources.map(row => ({ ...row, metadata: JSON.parse(String(row.metadata)) })) as unknown as ProjectSourceDoc[], "_id")(state.projectSources);
    reconcile(projectCheckpoints as unknown as ProjectCheckpointDoc[], "_id")(state.projectCheckpoints);
    reconcile(engagements as unknown as EngagementDoc[], "_id")(state.engagements);
    reconcile(obligationDocuments as unknown as ObligationDocument[], "_id")(state.obligationDocuments);
    reconcile(commitments as unknown as CommitmentDoc[], "_id")(state.commitments);
    reconcile(obligationInvoices as unknown as InvoiceDoc[], "_id")(state.obligationInvoices);
    reconcile(obligationPayments as unknown as PaymentDoc[], "_id")(state.obligationPayments);
    reconcile(paymentAllocations as unknown as AllocationDoc[], "_id")(state.paymentAllocations);
    reconcile(schedules.map(row => ({ ...row, definition: JSON.parse(String(row.definition)) })) as unknown as ScheduleDoc[], "_id")(state.schedules);
    reconcile(occurrences as unknown as OccurrenceDoc[], "_id")(state.occurrences);
    reconcile(templates.map(row => ({ ...row, definition: JSON.parse(String(row.definition)) })) as unknown as TemplateDoc[], "_id")(state.templates);
    reconcile(workspaces.map(mapWorkspace), "_id")(state.workspaces);
    reconcile(areas.map(mapArea), "_id")(state.areas);
    reconcile(view, "_id")(state.items);
    reconcile(mappedTags, "_id")(state.tags);
    reconcile(mappedLinks, "_id")(state.itemTags);
  });
}
