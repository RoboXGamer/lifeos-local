import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { api } from "../local/api";
import { templateSchema, templateVariables } from "../local/templates";
import { useWorkspaces } from "../features/workspaces/context";
import { useItemPanelRoute } from "../features/items/routing";
import { localDateKey } from "../features/items/dates";
import type { Id } from "../local/types";
import "./Productivity.css";
import "./Templates.css";

export default function Templates() {
  const workspaces = useWorkspaces();
  const panel = useItemPanelRoute();
  const workspaceId = () => workspaces.state.activeWorkspaceId!;
  const templates = () => api.templates.list({ workspaceId: workspaceId() });
  const [selectedId, setSelectedId] = createSignal("");
  const [search, setSearch] = createSignal("");
  const selected = () => templates().find(t => t._id === selectedId()) ?? templates()[0];
  const [startDate, setStartDate] = createSignal(localDateKey());
  const [areaId, setAreaId] = createSignal("");
  const [variables, setVariables] = createSignal<Record<string, string>>({});
  const [editor, setEditor] = createSignal<string | null>(null);
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const drafts = new Map<string, { editor: string | null; variables: Record<string, string> }>();
  createEffect(workspaceId, () => { drafts.clear(); setSelectedId(""); setAreaId(""); setVariables({}); setEditor(null); setMessage(""); });
  const selectTemplate = (id: string) => {
    const previous = selected()?._id;
    if (previous) drafts.set(previous, { editor: editor(), variables: { ...variables() } });
    const draft = drafts.get(id);
    setSelectedId(id); setEditor(draft?.editor ?? null); setVariables(draft?.variables ?? {}); setMessage("");
  };
  const request = () => ({ workspaceId: workspaceId(), templateId: selected()._id, startDate: startDate(), areaId: (areaId() || null) as Id<"areas"> | null, variables: variables() });
  const preview = createMemo(() => {
    try { return { value: api.templates.preview(request()), error: "" }; }
    catch (e) { return { value: undefined, error: e instanceof Error ? e.message : "Check template values." }; }
  });
  const perform = async (work: () => Promise<unknown>, success: string) => {
    if (busy()) return;
    setBusy(true); setMessage("");
    try { await work(); setMessage(success); } catch (e) { setMessage(e instanceof Error ? e.message : "Operation failed."); }
    finally { setBusy(false); }
  };
  const exportTemplate = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(selected().definition, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "lifeos-template.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section class="productivity-page templates-page">
    <header><div><h2>Templates</h2><p>Reusable starting points for your work and life.</p></div></header>
    <Show when={message()}><p class="productivity-message" role="status">{message()}</p></Show>
    <div class="productivity-layout">
      <aside class="productivity-list template-library" aria-label="Template library">
        <label class="template-search"><span>Search templates</span><input type="search" placeholder="Search templates…" value={search()} onInput={e => setSearch(e.currentTarget.value)} /></label>
        <For each={templates().filter(t => t.name.toLowerCase().includes(search().trim().toLowerCase()))} keyed={t => t._id} fallback={<p>No templates match your search.</p>}>{t => <button disabled={busy()} class={{ selected: selected()._id === t()._id }} onClick={() => selectTemplate(t()._id)}><strong>{t().name}</strong><small>{t().definition.entries.length} items · {t().builtin ? "Starter" : `Version ${t().version}`}</small></button>}</For>
        <label class="productivity-import">Import template<input type="file" accept="application/json,.json" disabled={busy()} onChange={event => {
          const file = event.currentTarget.files?.[0]; if (!file) return;
          const destination = workspaceId();
          void perform(async () => { if (file.size > 500000) throw new Error("Template files must be under 500 KB."); const definition = templateSchema.parse(JSON.parse(await file.text())); const id = await api.templates.save({ workspaceId: destination, definition }); if (workspaceId() === destination) selectTemplate(id); }, "Template imported.");
          event.currentTarget.value = "";
        }} /></label>
      </aside>
      <div class="productivity-card template-detail">
        <div class="template-detail-heading"><small>{selected().builtin ? "STARTER TEMPLATE" : "YOUR TEMPLATE"}</small><h3>{selected().name}</h3><p>Choose a start date and destination, then preview your items.</p></div>
        <div class="productivity-fields">
          <label>Start date<input type="date" value={startDate()} onInput={e => setStartDate(e.currentTarget.value)} /></label>
          <label>Destination<select value={areaId()} onChange={e => setAreaId(e.currentTarget.value)}><option value="">Inbox</option><For each={api.areas.list({ workspaceId: workspaceId() })} keyed={a => a._id}>{a => <option value={a()._id}>{a().name}</option>}</For></select></label>
          <For each={templateVariables(selected().definition)}>{key => <label>{key}<input value={variables()[key] ?? ""} onInput={e => setVariables({ ...variables(), [key]: e.currentTarget.value })} /></label>}</For>
        </div>
        <h4 class="template-preview-heading">Preview · {selected().definition.entries.length} items</h4>
        <Show when={preview().value} fallback={<p>{preview().error}</p>}>{value => <ol class="productivity-preview"><For each={value().items}>{item => <li><strong>{item.title}</strong><small>{item.type}{item.dueDate ? ` · ${item.dueDate}` : ""}{item.amount !== null ? ` · ${item.amount} (${item.financialState})` : ""}</small></li>}</For></ol>}</Show>
        <div class="productivity-actions"><button class="primary-action" disabled={busy() || !preview().value} onClick={() => void perform(async () => { const id = await api.templates.apply(request()); panel.openItem(id); }, "Template created. Your items are independent of the template.")}>{busy() ? "Working…" : "Use this template"}</button><button onClick={exportTemplate}>Export</button><button disabled={busy()} onClick={() => void perform(async () => { const definition = { ...selected().definition, name: `${selected().name.slice(0, 70)} copy` }; selectTemplate(await api.templates.save({ workspaceId: workspaceId(), definition })); }, "Template duplicated.")}>Duplicate</button></div>
        <details class="productivity-editor"><summary>Edit template structure</summary><p>Use {"{{client}}"} or {"{{project}}"} in titles and notes. Dates are offsets from the start date. The first entry is the parent.</p><textarea disabled={busy()} aria-label="Template definition" rows={14} value={editor() ?? JSON.stringify(selected().definition, null, 2)} onInput={e => setEditor(e.currentTarget.value)} /><div class="productivity-actions"><button disabled={busy()} onClick={() => void perform(async () => { const template = selected(); const definition = templateSchema.parse(JSON.parse(editor() ?? JSON.stringify(template.definition))); const id = await api.templates.save({ workspaceId: workspaceId(), templateId: template._id, expectedVersion: template.version, definition }); drafts.delete(template._id); setSelectedId(id); setEditor(null); }, "Template saved. Existing items were not changed.")}>{selected().builtin ? "Save as my template" : "Save changes"}</button><Show when={!selected().builtin}><button disabled={busy()} onClick={() => void perform(async () => { const id = selected()._id; await api.templates.remove({ workspaceId: workspaceId(), templateId: id }); drafts.delete(id); setSelectedId(""); setEditor(null); setVariables({}); }, "Template deleted. Created items remain.")}>Delete template</button></Show></div></details>
      </div>
    </div>
  </section>;
}
