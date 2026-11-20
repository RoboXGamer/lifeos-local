import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { api } from "../../local/api";
import { data } from "../../local/store";
import { addDays } from "../../local/templates";
import { localDateKey } from "../items/dates";
import { useWorkspaces } from "../workspaces/context";
import type { Id } from "../../local/types";
import "./TodayAttention.css";

export function TodayAttention(props: { today: string }) {
  const workspaces = useWorkspaces();
  const workspaceId = () => workspaces.state.activeWorkspaceId!;
  const [capacity, setCapacity] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(workspaceId, id => {
    const saved = localStorage.getItem(`lifeos-attention-minutes:${id}`) ?? "";
    setCapacity(/^\d+$/.test(saved) && Number(saved) > 0 && Number(saved) <= 1440 ? saved : ""); setMessage("");
  });
  const overview = createMemo(() => data.workspaces.some(w => w._id === workspaceId() && !w.archived)
    ? api.attention.build({ workspaceId: workspaceId(), availableMinutes: capacity() ? Number(capacity()) : undefined, date: props.today })
    : { suggestions: [], hiddenCount: 0, eligibleCount: 0, availableMinutes: null });
  const feedback = () => data.attentionFeedback.filter(f => f.workspaceId === workspaceId());
  const perform = async (work: () => Promise<unknown>, success: string) => {
    if (busy()) return; setBusy(true); setMessage("");
    try { await work(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save your preference."); }
    finally { setBusy(false); }
  };
  return <section class="today-attention" aria-label="Worth your attention">
    <header><div><h3>Worth your attention</h3><p>Up to three suggestions, with the records behind each one.</p></div><label>Time available<select aria-label="Available minutes" value={capacity()} onChange={e => {
      const value = e.currentTarget.value; setCapacity(value);
      if (value) localStorage.setItem(`lifeos-attention-minutes:${workspaceId()}`, value); else localStorage.removeItem(`lifeos-attention-minutes:${workspaceId()}`);
    }}><option value="">Not set</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><Show when={capacity() && !["15", "30", "60", "120"].includes(capacity())}><option value={capacity()}>{capacity()} minutes</option></Show></select></label></header>
    <Show when={message()}><p class="attention-message" role="status">{message()}</p></Show>
    <div class="attention-grid"><For each={overview().suggestions} keyed={s => s._id} fallback={<p class="attention-empty">No recorded issue needs a suggestion right now. Add a waiting tag, a deadline, a checkpoint, or a task estimate to give this view useful context.</p>}>{suggestion => <article class="attention-card">
      <span class="attention-kind">{({ waiting: "Waiting on", payment: "Client commitments", decision: "Decision memory", shipping: "One useful outcome", maintenance: "Life maintenance" })[suggestion().kind]}</span>
      <h4>{suggestion().title}</h4><p>{suggestion().reason}</p><p class="attention-detail">{suggestion().detail}</p>
      <a class="attention-source" href={suggestion().href}>{suggestion().sourceLabel}</a>
      <div class="attention-actions"><button disabled={busy()} onClick={() => void perform(() => api.attention.feedback({ workspaceId: workspaceId(), suggestionId: suggestion()._id, action: "snooze", untilDate: addDays(localDateKey(), 1) }), "Snoozed until tomorrow.")}>Tomorrow</button><button disabled={busy()} onClick={() => void perform(() => api.attention.feedback({ workspaceId: workspaceId(), suggestionId: suggestion()._id, action: "dismiss" }), "Dismissed for this recorded state. New evidence can appear again.")}>Dismiss</button></div>
      <Show when={suggestion().itemId && data.items.some(i => i._id === suggestion().itemId && i.type === "Task" && !i.archived)}><details><summary>Set an honest time estimate</summary><form onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget);
        void perform(() => api.attention.estimate({ workspaceId: workspaceId(), itemId: suggestion().itemId as Id<"items">, minutes: Number(values.get("minutes")) }), "Task estimate saved.");
      }}><label>Estimated minutes<input name="minutes" type="number" min={1} max={1440} required value={suggestion().estimatedMinutes ?? ""} /></label><button disabled={busy()}>Save estimate</button></form></details></Show>
      <details><summary>Correct or snooze this suggestion</summary><form onSubmit={e => {
        e.preventDefault(); const values = new FormData(e.currentTarget); const date = String(values.get("until") ?? "");
        void perform(() => api.attention.feedback({ workspaceId: workspaceId(), suggestionId: suggestion()._id, action: date ? "snooze" : "dismiss", untilDate: date || undefined, note: String(values.get("note") ?? "") }), "Correction saved. Edit the linked record to update its underlying facts.");
      }}><label>Correction or reason<textarea name="note" maxlength={1000} rows={2} placeholder="Already handled, waiting until Friday, wrong assumption…" /></label><label>Snooze until (optional)<input name="until" type="date" min={addDays(localDateKey(), 1)} /></label><button disabled={busy()}>Save preference</button></form></details>
    </article>}</For></div>
    <Show when={feedback().length}><details class="attention-history"><summary>Dismissed and snoozed preferences ({feedback().length})</summary><ul><For each={feedback()} keyed={f => f._id}>{record => <li><span>{record().action === "snooze" ? `Snoozed until ${record().untilDate}` : "Dismissed"}{record().note ? ` · ${record().note}` : ""}<small>Saved {new Date(record().updatedAt).toLocaleDateString()}</small></span><button disabled={busy()} onClick={() => void perform(() => api.attention.feedback({ workspaceId: workspaceId(), suggestionId: record().suggestionId, action: "reset" }), "Preference reset.")}>Reset</button></li>}</For></ul></details></Show>
  </section>;
}
