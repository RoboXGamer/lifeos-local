import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { api } from "../local/api";
import { automationRecipes, automationSchema } from "../local/automations";
import type { AutomationDefinition } from "../local/automations";
import { templateVariables } from "../local/templates";
import { data } from "../local/store";
import { useWorkspaces } from "../features/workspaces/context";
import { useItemPanelRoute } from "../features/items/routing";
import "./Productivity.css";
import "./Automation.css";

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export default function Automations() {
  const workspaces = useWorkspaces();
  const panel = useItemPanelRoute();
  const workspaceId = () => workspaces.state.activeWorkspaceId!;
  const rules = () => api.automations.list({ workspaceId: workspaceId() });
  const [selectedId, setSelectedId] = createSignal("");
  const selected = () => rules().find(rule => rule._id === selectedId());
  const [definition, setDefinition] = createSignal<AutomationDefinition>(automationRecipes(timezone())[0]);
  const [sampleId, setSampleId] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(workspaceId, () => { setSelectedId(""); setDefinition(automationRecipes(timezone())[0]); setSampleId(""); setMessage(""); });
  const runs = () => api.automations.runs({ workspaceId: workspaceId(), automationId: selectedId() || undefined });
  const candidates = () => data.items.filter(item => item.workspaceId === workspaceId() && !item.archived);
  const templates = () => api.templates.list({ workspaceId: workspaceId() });
  const isProgress = () => ["habit_target_met", "goal_target_reached"].includes(definition().trigger.kind);
  const preview = createMemo(() => {
    try { return { value: api.automations.preview({ workspaceId: workspaceId(), definition: definition(), itemId: isProgress() ? undefined : sampleId() || undefined }), error: "" }; }
    catch (error) { return { value: undefined, error: error instanceof Error ? error.message : "Check rule values." }; }
  });
  const trigger = (values: Partial<AutomationDefinition["trigger"]>) => setDefinition({ ...definition(), trigger: { ...definition().trigger, ...(values.kind && values.kind !== definition().trigger.kind ? { entityId: null } : {}), ...values }, ...(["schedule", "habit_target_met", "goal_target_reached"].includes(values.kind ?? "") ? { conditions: { areaId: null, type: null, status: null, tags: [] }, action: { ...definition().action, kind: definition().action.kind === "update_item" ? "reminder" : definition().action.kind } } : {}) });
  const condition = (values: Partial<AutomationDefinition["conditions"]>) => setDefinition({ ...definition(), conditions: { ...definition().conditions, ...values } });
  const action = (values: Partial<AutomationDefinition["action"]>) => setDefinition({ ...definition(), action: { ...definition().action, ...values } });
  const perform = async (work: () => Promise<unknown>, success: string) => {
    if (busy()) return;
    setBusy(true); setMessage("");
    try { await work(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
    finally { setBusy(false); }
  };
  const selectRule = (id: string) => {
    const rule = rules().find(value => value._id === id);
    if (!rule) return;
    setSelectedId(id); setDefinition(JSON.parse(JSON.stringify(rule.definition))); setSampleId(""); setMessage("");
  };
  return <section class="productivity-page">
    <header><div><h2>Automations</h2><p>Small rules that take care of repeat coordination.</p></div><button onClick={() => { setSelectedId(""); setDefinition(automationSchema.parse({ name: "My automation", trigger: { kind: "item_created", timezone: timezone() }, action: { kind: "reminder" } })); setSampleId(""); }}>New rule</button></header>
    <p class="automation-help">Rules run in the local service, including with the desktop window closed. Missed scheduled work is recovered when the service starts. New rules start paused.</p>
    <Show when={message()}><p class="productivity-message" role="status">{message()}</p></Show>
    <div class="automation-recipes"><For each={automationRecipes(timezone())}>{recipe => <button disabled={busy()} onClick={() => void perform(async () => { setSelectedId(await api.automations.save({ workspaceId: workspaceId(), definition: recipe, enabled: false })); setDefinition(recipe); }, "Recipe added, paused. Preview it, then enable when ready.")}><strong>{recipe.name}</strong><small>Add recipe</small></button>}</For></div>
    <div class="productivity-layout">
      <aside class="productivity-list" aria-label="Automation rules"><For each={rules()} keyed={rule => rule._id} fallback={<p>No saved rules yet. Add a recipe or create a rule.</p>}>{rule => <button class={{ selected: selectedId() === rule()._id }} onClick={() => selectRule(rule()._id)}><strong>{rule().name}</strong><small>{rule().enabled ? "Enabled" : "Paused"}{rule().nextRunDate ? ` · next ${rule().nextRunDate}` : ""}</small></button>}</For></aside>
      <form class="productivity-card" onSubmit={event => { event.preventDefault(); void perform(async () => { const id = await api.automations.save({ workspaceId: workspaceId(), automationId: selectedId() || undefined, definition: definition(), enabled: selected()?.enabled ?? false }); setSelectedId(id); }, "Rule saved. Existing queued work from the previous version was cancelled."); }}>
        <h3>{selected() ? "Edit rule" : "New rule"}</h3>
        <label>Name<input value={definition().name} maxlength={80} required onInput={e => setDefinition({ ...definition(), name: e.currentTarget.value })} /></label>
        <div class="productivity-fields">
          <label>When<select value={definition().trigger.kind} onChange={e => { setSampleId(""); trigger({ kind: e.currentTarget.value as AutomationDefinition["trigger"]["kind"] }); }}><option value="schedule">Weekly schedule</option><option value="item_created">Item created</option><option value="status_changed">Task status changes</option><option value="due_date">Item becomes due</option><option value="inactivity">Project inactivity</option><option value="habit_target_met">Habit daily target met</option><option value="goal_target_reached">Goal target reached</option></select></label>
          <Show when={isProgress()}><label>{definition().trigger.kind === "habit_target_met" ? "Habit" : "Goal"}<select value={definition().trigger.entityId ?? ""} onChange={e => trigger({ entityId: e.currentTarget.value || null })}><option value="">Any in this workspace</option><For each={definition().trigger.kind === "habit_target_met" ? api.habits.list({ workspaceId: workspaceId() }) : api.goals.list({ workspaceId: workspaceId() })} keyed={entity => entity._id}>{entity => <option value={entity()._id}>{entity().title}</option>}</For></select></label></Show>
          <label>Timezone<input value={definition().trigger.timezone} required onInput={e => trigger({ timezone: e.currentTarget.value })} /></label>
          <Show when={definition().trigger.kind === "schedule"}><label>Day<select value={definition().trigger.weekday} onChange={e => trigger({ weekday: Number(e.currentTarget.value) })}><For each={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]}>{(day, index) => <option value={index()}>{day}</option>}</For></select></label></Show>
          <Show when={definition().trigger.kind === "inactivity"}><label>Days without activity<input type="number" min={1} max={3650} value={definition().trigger.days} onInput={e => trigger({ days: Number(e.currentTarget.value) })} /></label></Show>
        </div>
        <Show when={definition().trigger.kind !== "schedule"}>
          <h4>Only when these conditions match</h4><div class="productivity-fields">
            <label>Area<select value={definition().conditions.areaId ?? ""} onChange={e => condition({ areaId: e.currentTarget.value || null })}><option value="">Any area</option><For each={api.areas.list({ workspaceId: workspaceId() })} keyed={area => area._id}>{area => <option value={area()._id}>{area().name}</option>}</For></select></label>
            <Show when={!isProgress()}><label>Type<select value={definition().conditions.type ?? ""} onChange={e => condition({ type: (e.currentTarget.value || null) as AutomationDefinition["conditions"]["type"] })}><option value="">Any type</option><For each={["Task", "Note", "Event", "Expense", "Income"]}>{type => <option>{type}</option>}</For></select></label>
            <label>Status<select value={definition().conditions.status ?? ""} onChange={e => condition({ status: (e.currentTarget.value || null) as AutomationDefinition["conditions"]["status"] })}><option value="">Any status</option><option>Todo</option><option>In Progress</option><option>Done</option></select></label>
            <label>All tags (comma-separated)<input value={definition().conditions.tags.join(", ")} onInput={e => condition({ tags: e.currentTarget.value.split(",").map(value => value.trim()).filter(Boolean) })} /></label></Show>
          </div>
        </Show>
        <h4>Then</h4><div class="productivity-fields">
          <label>Action<select value={definition().action.kind} onChange={e => action({ kind: e.currentTarget.value as AutomationDefinition["action"]["kind"] })}><option value="create_item">Create item</option><option value="apply_template">Apply template</option><option value="reminder">Show in-app reminder</option><Show when={definition().trigger.kind !== "schedule" && !isProgress()}><option value="update_item">Update matching item</option></Show></select></label>
          <Show when={definition().action.kind === "create_item"}><label>New item type<select value={definition().action.type} onChange={e => action({ type: e.currentTarget.value as AutomationDefinition["action"]["type"] })}><option>Task</option><option>Note</option><option>Event</option></select></label></Show>
          <Show when={definition().action.kind !== "apply_template"}><label>Due in days<input type="number" min={-3650} max={3650} value={definition().action.dueOffset} onInput={e => action({ dueOffset: Number(e.currentTarget.value) })} /></label></Show>
        </div>
        <Show when={definition().action.kind === "apply_template"} fallback={<Show when={definition().action.kind !== "update_item"}><label>Title<input value={definition().action.title} maxlength={200} onInput={e => action({ title: e.currentTarget.value })} /></label><label>Notes<textarea rows={3} value={definition().action.description} onInput={e => action({ description: e.currentTarget.value })} /></label><label>New item tags<input value={definition().action.tags.join(", ")} onInput={e => action({ tags: e.currentTarget.value.split(",").map(value => value.trim()).filter(Boolean) })} /></label><small>Use {"{{title}}"}, {"{{date}}"}, and {"{{status}}"} for values from the source item.</small></Show>}>
          <label>Template<select value={definition().action.templateId} onChange={e => action({ templateId: e.currentTarget.value })}><For each={templates()} keyed={template => template._id}>{template => <option value={template()._id}>{template().name}</option>}</For></select></label>
          <For each={templateVariables(templates().find(template => template._id === definition().action.templateId)?.definition ?? templates()[0].definition)}>{key => <label>{key}<input value={definition().action.variables[key] ?? ""} onInput={e => action({ variables: { ...definition().action.variables, [key]: e.currentTarget.value } })} /></label>}</For><small>Use {"{{title}}"} to fill a variable from the matching item's title.</small>
        </Show>
        <Show when={definition().action.kind === "update_item"}><div class="productivity-fields"><label>Task status<select value={definition().action.status ?? ""} onChange={e => action({ status: (e.currentTarget.value || null) as AutomationDefinition["action"]["status"] })}><option value="">Keep current</option><option>Todo</option><option>In Progress</option><option>Done</option></select></label><label>Priority<select value={definition().action.priority ?? ""} onChange={e => action({ priority: (e.currentTarget.value ? Number(e.currentTarget.value) : null) as AutomationDefinition["action"]["priority"] })}><option value="">Keep current</option><option value={1}>High</option><option value={2}>Medium</option><option value={3}>Low</option></select></label></div></Show>
        <div class="automation-preview"><h4>Preview</h4><Show when={definition().trigger.kind !== "schedule" && !isProgress()}><label>Example source item<select value={sampleId()} onChange={e => setSampleId(e.currentTarget.value)}><option value="">Choose an item to test conditions</option><For each={candidates()} keyed={item => item._id}>{item => <option value={item()._id}>{item().title}</option>}</For></select></label></Show><Show when={preview().value} fallback={<p>{preview().error}</p>}>{value => <><p>{value().explanation}</p><small>{value().matches ? "Conditions match." : "This example does not match the conditions."} Preview creates nothing.</small><ul><For each={value().output}>{title => <li>{title}</li>}</For></ul></>}</Show></div>
        <div class="productivity-actions"><button type="submit" class="primary-action" disabled={busy()}>Save rule</button><Show when={selected()}>{rule => <><button type="button" disabled={busy()} onClick={() => void perform(() => api.automations.setEnabled({ workspaceId: workspaceId(), automationId: rule()._id, enabled: !rule().enabled }), rule().enabled ? "Rule paused." : "Rule enabled.")}>{rule().enabled ? "Pause" : "Enable"}</button><button type="button" disabled={busy()} onClick={() => void perform(async () => { await api.automations.remove({ workspaceId: workspaceId(), automationId: rule()._id }); setSelectedId(""); }, "Rule deleted. Run history is retained.")}>Delete</button></>}</Show></div>
      </form>
    </div>
    <section class="productivity-card"><h3>Run history {selected() ? `· ${selected()!.name}` : ""}</h3><For each={runs()} keyed={value => value._id} fallback={<p>No runs yet. Rules begin recording when enabled and triggered.</p>}>{value => <article class="automation-run"><div><strong>{value().input.definition.name}</strong><small>{value().status} · {new Date(value().createdAt).toLocaleString()} · {value().attempts} attempt(s)</small><p>{value().input.explanation}</p><Show when={value().error}><p role="status">{value().error}</p></Show><Show when={value().result}><p>{value().result?.message}</p></Show></div><div class="productivity-actions"><Show when={value().result?.itemId}><button onClick={() => panel.openItem(value().result!.itemId!)}>Open item</button></Show><Show when={value().status === "failed"}><button disabled={busy()} onClick={() => void perform(() => api.automations.retry({ workspaceId: workspaceId(), runId: value()._id }), "Run queued for retry.")}>Retry</button></Show></div></article>}</For></section>
  </section>;
}
