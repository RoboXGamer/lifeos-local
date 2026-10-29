import { data } from "./store";
import type { ProjectDoc, ProjectCheckpointDoc } from "./projects";

type Checkpoint = ProjectCheckpointDoc & { sourceKind: "structured" | "note"; sourceIdentity: string };
/** One ordering and parser for resume, revival planning, and Today. Notes remain intact. */
export function latestProjectCheckpoint(project: ProjectDoc): Checkpoint | undefined {
  const structured = data.projectCheckpoints.filter(c => c.projectId === project._id && c.workspaceId === project.workspaceId);
  const structuredItems = new Set(structured.map(c => c.itemId));
  const candidates: Checkpoint[] = structured.map(c => ({ ...c, sourceKind: "structured", sourceIdentity: `projectCheckpoint:${c._id}` }));
  for (const note of data.items.filter(i => i.workspaceId === project.workspaceId && i.parentId === project.itemId && i.type === "Note" && !i.archived && !structuredItems.has(i._id) && (i.tags.some(t => t.toLowerCase() === "checkpoint") || i.title.startsWith("Checkpoint:")))) {
    const fields = new Map<string, string>();
    const body = (note.description ?? "").replaceAll("\r\n", "\n");
    const sections = [...body.matchAll(/^(What changed|What failed|Why I stopped|Next action)\n/gm)];
    sections.forEach((section, index) => fields.set(section[1], body.slice(section.index! + section[0].length, sections[index + 1]?.index ?? body.length).trim()));
    const failed = fields.get("What failed") ?? "";
    candidates.push({ _id: note._id, workspaceId: project.workspaceId, projectId: project._id, itemId: note._id, did: fields.get("What changed") ?? "", failed: /^(No failures? recorded\.?|None recorded)$/i.test(failed) ? "" : failed, whyStopped: fields.get("Why I stopped") ?? "", next: fields.get("Next action") ?? "", branch: "", commit: "", createdAt: note.createdAt, sourceKind: "note", sourceIdentity: `item:${note._id}` });
  }
  // Structured wins equal timestamps; within each kind, descending immutable ID breaks ties.
  return candidates.sort((a, b) => b.createdAt - a.createdAt || Number(b.sourceKind === "structured") - Number(a.sourceKind === "structured") || b._id.localeCompare(a._id))[0];
}
