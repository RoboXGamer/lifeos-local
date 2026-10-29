import { nanoid } from "nanoid";
import { z } from "zod";
import { data } from "./store";
import { run, select } from "./db";
import { requireWorkspace, type CreateItem } from "./templates";
import type { Id } from "./types";
import { latestProjectCheckpoint } from "./checkpoints";

const settingsSchema = z.object({
  repositories: z.array(z.string().trim().min(1).max(1000).refine(p => /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p), "Use absolute repository paths.")).max(8).default([]),
  exclusions: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  retentionDays: z.number().int().min(7).max(3650).default(365),
});
const projectSchema = z.object({
  name: z.string().trim().min(1).max(80), goal: z.string().trim().max(2000).default(""),
  audience: z.string().trim().max(1000).default(""), valueStatement: z.string().trim().max(2000).default(""),
  status: z.enum(["active", "paused", "archived"]).default("active"), settings: settingsSchema,
});
export interface ProjectDoc {
  _id: string; workspaceId: Id<"workspaces">; itemId: Id<"items">; name: string; goal: string;
  audience: string; valueStatement: string; status: "active" | "paused" | "archived";
  settings: z.infer<typeof settingsSchema>; lastScannedAt: number | null; createdAt: number; updatedAt: number;
}
export interface ProjectSourceDoc {
  _id: string; workspaceId: Id<"workspaces">; projectId: string;
  kind: "git" | "file" | "link" | "editor" | "terminal" | "note";
  locator: string; label: string; content: string; contentHash: string;
  metadata: Record<string, unknown>; capturedAt: number; missing: number;
}
export interface ProjectCheckpointDoc {
  _id: string; workspaceId: Id<"workspaces">; projectId: string; itemId: Id<"items">;
  did: string; failed: string; whyStopped: string; next: string; branch: string; commit: string; createdAt: number;
}
export type ProjectArgs = { workspaceId: Id<"workspaces">; projectId: string };
export type CollectedSource = Pick<ProjectSourceDoc, "kind" | "locator" | "label" | "content" | "metadata" | "missing">;
export type ProjectCollector = (settings: ProjectDoc["settings"]) => Promise<CollectedSource[]>;
let collector: ProjectCollector | undefined;
export function setProjectCollector(value: ProjectCollector): void { collector = value; }

export function redactProjectSecrets(text: string): string {
  return text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{15,}|github_pat_[A-Za-z0-9_]{15,})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{10,}/gi, "Bearer [REDACTED]");
}
async function hash(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, "0")).join("");
}
function requireProject(args: ProjectArgs): ProjectDoc {
  requireWorkspace(args.workspaceId);
  const project = data.projects.find(p => p._id === args.projectId && p.workspaceId === args.workspaceId);
  if (!project) throw new Error("Project not found in this Workspace.");
  return project;
}
function rootItem(project: ProjectDoc) {
  const item = data.items.find(i => i._id === project.itemId && i.workspaceId === project.workspaceId && !i.parentId);
  if (!item || item.archived) throw new Error("Restore the project's root Item before changing project records.");
  return item;
}
export function listProjects(args: { workspaceId: Id<"workspaces"> }): ProjectDoc[] {
  return data.projects.filter(p => p.workspaceId === args.workspaceId).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function listProjectSources(args: ProjectArgs & { query?: string; history?: boolean }): ProjectSourceDoc[] {
  requireProject(args);
  const sources = data.projectSources.filter(s => s.projectId === args.projectId && s.workspaceId === args.workspaceId).sort((a, b) => b.capturedAt - a.capturedAt || Number(b.metadata.revision??0)-Number(a.metadata.revision??0) || b._id.localeCompare(a._id));
  const latest = new Set<string>();
  return sources.filter(s => {
    const key = `${s.kind}:${s.locator}`;
    if (!args.history && latest.has(key)) return false;
    latest.add(key);
    return !args.query?.trim() || `${s.label}\n${s.content}\n${s.locator}`.toLowerCase().includes(args.query.trim().toLowerCase());
  });
}
export function listProjectCheckpoints(args: ProjectArgs): ProjectCheckpointDoc[] {
  requireProject(args);
  return data.projectCheckpoints.filter(c => c.projectId === args.projectId && c.workspaceId === args.workspaceId).sort((a, b) => b.createdAt - a.createdAt || b._id.localeCompare(a._id));
}
export function resumeProject(args: ProjectArgs) {
  const project = requireProject(args);
  const checkpoint = latestProjectCheckpoint(project);
  const sources = listProjectSources(args);
  return {
    project, recordedAt: checkpoint?.createdAt ?? null,
    lastGoal: project.goal || "No goal recorded.",
    lastWork: checkpoint?.did || "No previous work recorded.",
    failedAttempts: checkpoint?.failed || "No failures recorded.",
    whyStopped: checkpoint?.whyStopped || "No reason recorded.",
    nextAction: checkpoint?.next || "Record the current state and choose one next action.",
    nextActionKind: checkpoint?.next ? "recorded" as const : "suggestion" as const,
    branch: checkpoint?.branch || String(sources.find(s => s.metadata.branch)?.metadata.branch ?? "Unknown"),
    commit: checkpoint?.commit || String(sources.find(s => s.metadata.head)?.metadata.head ?? "Unknown"),
    checkpointId: checkpoint?.itemId ?? null,
    checkpointSource: checkpoint?.sourceIdentity ?? null,
    sources: sources.map(s => ({ ...s, stale: Date.now() - s.capturedAt > 7 * 86400000 })),
    verification: "Captured evidence only. A historical command, build, test, or deployment has not been re-run.",
  };
}
export function reportProject(args: ProjectArgs) {
  const project = requireProject(args);
  const brief = resumeProject(args);
  const sources = brief.sources;
  const manifests = sources.filter(s => s.kind === "file" && s.metadata.category === "manifest" && !s.missing);
  const docs = sources.filter(s => s.kind === "file" && s.metadata.category === "readme" && !s.missing);
  const inventory = sources.filter(s => s.metadata.category === "inventory" && !s.missing);
  const evidence = [...manifests, ...docs, ...inventory];
  const valueKnown = !!project.audience && !!project.valueStatement && !!project.goal;
  const recommendation = project.status === "archived" ? "archive" : !valueKnown || !sources.length ? "review" : manifests.length ? "revive" : evidence.length ? "salvage" : "review";
  const steps = [
    ...(valueKnown ? [] : ["Confirm who needs this project and the smallest useful outcome"]),
    ...(brief.nextActionKind === "recorded" ? [brief.nextAction] : []),
    "Reproduce the last working state using the repository's documented setup",
    `Implement only the smallest release: ${(project.goal || project.name).slice(0, 130)}`,
    "Run relevant checks and verify the chosen delivery path",
    "Ship the timeboxed release or record why it should stay paused",
  ].slice(0, 6);
  return {
    projectId: project._id, projectName: project.name, recommendation,
    confidence: sources.length >= 3 && valueKnown ? "medium" : "low",
    reportKey: `${project.updatedAt}:${JSON.stringify([project.goal,project.audience,project.valueStatement,project.status,project.settings])}:${sources.map(s => s.contentHash).sort().join(":")}:${brief.recordedAt ?? 0}:${brief.nextAction}`,
    rationale: !valueKnown ? "Product value needs a recorded audience, goal, and reason to revive." : !sources.length ? "Inspect selected repositories before deciding technical readiness." : `Static evidence supports a ${recommendation} review; runtime readiness remains unverified.`,
    reusable: evidence.map(s => ({ sourceId: s._id, label: s.label, locator: s.locator, reason: s.metadata.category === "manifest" ? "Existing dependencies and scripts can inform the setup; none were executed." : s.metadata.category === "inventory" ? "Existing source/test files are candidates for reuse; behavior is unverified." : "Existing documentation preserves original intent and setup instructions." })),
    uncertain: ["Dependency support and obsolescence have not been checked against current upstream releases. Offline freshness is unknown.", "A long gap since the last commit does not prove that code is obsolete.", ...sources.filter(s => s.missing).map(s => `${s.label}: source is missing or inaccessible.`), ...sources.filter(s => s.stale).map(s => `${s.label}: snapshot is over seven days old.`)],
    readiness: "Static inspection only; build, tests, deployment, and business demand are unverified.",
    estimate: { range: "1–3 focused sessions for an initial revival experiment", assumptions: "Planning suggestion, not a delivery estimate. Assumes setup can be reproduced, one narrow outcome is chosen, and no major migration is needed. Re-estimate after the first verified run." },
    steps, sourceIds: sources.map(s => s._id),
  };
}

export function createProjects(dependencies: { createItem: CreateItem }) {
  const { createItem } = dependencies;
  const create = async (args: { workspaceId: Id<"workspaces">; itemId: Id<"items"> } & z.input<typeof projectSchema>) => {
    requireWorkspace(args.workspaceId);
    const value = projectSchema.parse(args);
    const item = data.items.find(i => i._id === args.itemId && i.workspaceId === args.workspaceId && !i.parentId && !i.archived);
    if (!item) throw new Error("Choose an active top-level Item as the project root.");
    if (data.projects.some(p => p.workspaceId === args.workspaceId && p.itemId === args.itemId)) throw new Error("This Item already has project metadata.");
    const id = nanoid(); const now = Date.now();
    await run("INSERT INTO projects (_id,workspaceId,itemId,name,goal,audience,valueStatement,status,settings,lastScannedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)", [id,args.workspaceId,args.itemId,value.name,value.goal,value.audience,value.valueStatement,value.status,JSON.stringify(value.settings),now,now]);
    return id;
  };
  const update = async (args: ProjectArgs & z.input<typeof projectSchema>) => {
    const project = requireProject(args); const value = projectSchema.parse(args);
    await run("UPDATE projects SET name=?,goal=?,audience=?,valueStatement=?,status=?,settings=?,updatedAt=? WHERE _id=? AND workspaceId=?", [value.name,value.goal,value.audience,value.valueStatement,value.status,JSON.stringify(value.settings),Date.now(),project._id,args.workspaceId]);
    return null;
  };
  const checkpoint = async (args: ProjectArgs & { did: string; failed?: string; whyStopped?: string; next: string; branch?: string; commit?: string }) => {
    const project = requireProject(args); const root = rootItem(project);
    const value = z.object({ did:z.string().trim().min(1).max(5000),failed:z.string().trim().max(5000).default(""),whyStopped:z.string().trim().max(2000).default(""),next:z.string().trim().min(1).max(2000),branch:z.string().trim().max(200).default(""),commit:z.string().trim().max(200).default("") }).parse(args);
    for (const key of Object.keys(value) as (keyof typeof value)[]) value[key] = redactProjectSecrets(value[key]);
    const now = Date.now();
    const itemId = await createItem({ workspaceId:args.workspaceId,title:`Checkpoint: ${project.name}`.slice(0,200),type:"Note",description:`What changed\n${value.did}\n\nWhat failed\n${value.failed || "None recorded"}\n\nWhy I stopped\n${value.whyStopped || "Not recorded"}\n\nNext action\n${value.next}`,areaId:root.areaId,parentId:root._id,tags:["checkpoint"],status:null,priority:null,dueDate:null,amount:null,financialState:null }, { origin: "project", sourceId: project._id });
    const id = nanoid();
    await run('INSERT INTO projectCheckpoints (_id,workspaceId,projectId,itemId,did,failed,whyStopped,next,branch,"commit",createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id,args.workspaceId,project._id,itemId,value.did,value.failed,value.whyStopped,value.next,value.branch,value.commit,now]);
    await run("UPDATE projects SET updatedAt=? WHERE _id=?", [now,project._id]);
    return id;
  };
  const storeSource = async (project: ProjectDoc, source: CollectedSource, capturedAt: number) => {
    const content = redactProjectSecrets(source.content).slice(0,30000);
    const contentHash = await hash(`${source.missing}:${content}`);
    const [latest] = await select<{ _id:string; contentHash:string; metadata:string }>("SELECT _id,contentHash,metadata FROM projectSources WHERE projectId=? AND kind=? AND locator=? ORDER BY capturedAt DESC, rowid DESC LIMIT 1", [project._id,source.kind,source.locator]);
    const previousMetadata = latest ? JSON.parse(latest.metadata) : {};
    const metadata = {...source.metadata,revision:Number(previousMetadata.revision??0)+(latest?.contentHash===contentHash?0:1),...(latest?{supersedesId:latest._id}:{})};
    if (latest?.contentHash === contentHash) { await run("UPDATE projectSources SET capturedAt=?,metadata=? WHERE _id=?", [capturedAt,JSON.stringify(metadata),latest._id]); return latest._id; }
    const id = nanoid();
    await run("INSERT INTO projectSources (_id,workspaceId,projectId,kind,locator,label,content,contentHash,metadata,capturedAt,missing) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id,project.workspaceId,project._id,source.kind,source.locator,source.label,content,contentHash,JSON.stringify(metadata),capturedAt,source.missing]);
    return id;
  };
  const addSource = async (args: ProjectArgs & { kind: "link" | "editor" | "terminal" | "note"; locator:string; label:string; content:string }) => {
    const project = requireProject(args); rootItem(project);
    const source = z.object({ kind:z.enum(["link","editor","terminal","note"]), locator:z.string().trim().min(1).max(1500),label:z.string().trim().min(1).max(200),content:z.string().trim().min(1).max(30000) }).parse(args);
    if (source.kind === "link" && !/^https?:\/\//i.test(source.locator)) throw new Error("Saved browser links must use https:// or http://.");
    if (source.kind === "link") {
      const url = new URL(source.locator); url.username = ""; url.password = "";
      for (const key of [...url.searchParams.keys()]) if (/token|key|secret|password|auth/i.test(key)) url.searchParams.set(key,"REDACTED");
      source.locator = url.toString();
    }
    source.locator = redactProjectSecrets(source.locator); source.label = redactProjectSecrets(source.label);
    return storeSource(project,{...source,metadata:{ capture:"manual, explicitly supplied" },missing:0},Date.now());
  };
  const scan = async (args: ProjectArgs) => {
    const project = requireProject(args); rootItem(project);
    if (!collector) throw new Error("Repository collection is available through the LifeOS local service.");
    if (!project.settings.repositories.length) throw new Error("Add at least one repository path before scanning.");
    const sources = await collector(project.settings);
    const now = Date.now();
    const repositories = new Set(sources.map(s => String(s.metadata.repository ?? "").replace(/\\/g,"/").toLowerCase()));
    const captured = new Set(sources.map(s=>`${s.kind}:${s.locator}`));
    for (const prior of listProjectSources(args)) {
      if ((prior.kind === "git" || prior.kind === "file") && repositories.has(String(prior.metadata.repository ?? "").replace(/\\/g,"/").toLowerCase()) && !captured.has(`${prior.kind}:${prior.locator}`)) {
        sources.push({kind:prior.kind,locator:prior.locator,label:prior.label,content:"Previously captured source was not found in this scan. It may have been removed, excluded, or become inaccessible.",metadata:prior.metadata,missing:1});
      }
    }
    for (const source of sources) await storeSource(project,source,now);
    await run("DELETE FROM projectSources WHERE projectId=? AND capturedAt<?", [project._id,now-project.settings.retentionDays*86400000]);
    await run("UPDATE projects SET lastScannedAt=?,updatedAt=? WHERE _id=?", [now,now,project._id]);
    return { captured:sources.length,scannedAt:now };
  };
  const removeSource = async (args: ProjectArgs & { sourceId: string }) => {
    const project = requireProject(args);
    const source = data.projectSources.find(s=>s._id===args.sourceId && s.projectId===project._id && s.workspaceId===args.workspaceId);
    if (!source) throw new Error("Source not found in this project.");
    await run("DELETE FROM projectSources WHERE projectId=? AND kind=? AND locator=?", [project._id,source.kind,source.locator]);
    return null;
  };
  const acceptPlan = async (args: ProjectArgs & { reportKey:string }) => {
    const project = requireProject(args); const root = rootItem(project); const report = reportProject(args);
    if (args.reportKey !== report.reportKey) throw new Error("Project evidence changed. Review the current plan before accepting it.");
    const ids: string[] = [];
    for (let index=0;index<report.steps.length;index++) {
      const [existing] = await select<{ itemId:string }>("SELECT itemId FROM projectPlanTasks WHERE projectId=? AND reportKey=? AND stepIndex=?", [project._id,report.reportKey,index]);
      if (existing) { ids.push(existing.itemId); continue; }
      const id = await createItem({workspaceId:args.workspaceId,title:report.steps[index].slice(0,200),type:"Task",status:"Todo",description:`Revival plan for ${project.name}. ${report.readiness}\n\nEvidence: ${report.sourceIds.join(", ")}\n\n${report.estimate.assumptions}`,parentId:root._id,areaId:root.areaId,tags:["revival"],priority:null,dueDate:null,amount:null,financialState:null}, { origin: "project", sourceId: project._id });
      await run("INSERT INTO projectPlanTasks (projectId,reportKey,stepIndex,itemId) VALUES (?,?,?,?)", [project._id,report.reportKey,index,id]); ids.push(id);
    }
    return ids;
  };
  const remove = async (args:ProjectArgs & { confirmation:string }) => {
    const project=requireProject(args);
    if(args.confirmation!==project.name) throw new Error("Type the project name exactly to remove its memory.");
    for(const table of ["projectPlanTasks","projectCheckpoints","projectSources"]) await run(`DELETE FROM ${table} WHERE projectId=?`,[project._id]);
    await run("DELETE FROM projects WHERE _id=? AND workspaceId=?",[project._id,args.workspaceId]);
    return null;
  };
  return {create,update,checkpoint,addSource,scan,acceptPlan,removeSource,remove};
}
