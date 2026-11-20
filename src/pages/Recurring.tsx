import { createEffect, createSignal, For, Show } from "solid-js";
import { api } from "../local/api";
import { data } from "../local/store";
import { listOccurrences, listSchedules, recurrenceLabel } from "../local/recurrence";
import { useWorkspaces } from "../features/workspaces/context";
import { useItemPanelRoute } from "../features/items/routing";
import type { Id } from "../local/types";
import "./Productivity.css";

export default function Recurring() {
  const workspaces = useWorkspaces(); const panel = useItemPanelRoute();
  const workspaceId = () => workspaces.state.activeWorkspaceId!;
  const schedules = () => listSchedules({ workspaceId: workspaceId() });
  const [selectedId, setSelectedId] = createSignal("");
  const selected = () => schedules().find(s => s._id === selectedId()) ?? schedules()[0];
  const title = (itemId: string) => data.items.find(i => i._id === itemId)?.title ?? "Removed item";
  const [busy, setBusy] = createSignal(false); const [message, setMessage] = createSignal("");
  createEffect(workspaceId, () => { setSelectedId(""); setMessage(""); });
  const control = async (action: "pause" | "resume" | "end") => {
    const schedule = selected(); if (!schedule || busy()) return;
    setBusy(true); setMessage("");
    try { await api.recurrence.control({ workspaceId: workspaceId(), scheduleId: schedule._id, action }); setMessage("Schedule updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update schedule."); }
    finally { setBusy(false); }
  };
  return <section class="productivity-page">
    <header><div><h2>Recurring</h2><p>Repeat the work that keeps life running.</p></div></header>
    <p>Schedules run while the local service is running, even with the window closed. Missed dates catch up when the service resumes.</p>
    <Show when={message()}><p class="productivity-message" role="status">{message()}</p></Show>
    <Show when={schedules().length} fallback={<div class="productivity-card"><h3>No repeating items yet</h3><p>Open a Task, Expense, or Income item and choose “Repeat this item”.</p><a href="/app/areas">Open your items</a></div>}>
      <div class="productivity-layout"><aside class="productivity-list" aria-label="Recurring schedules"><For each={schedules()} keyed={s => s._id}>{s => <button class={{ selected: selected()?._id === s()._id }} onClick={() => setSelectedId(s()._id)}><strong>{title(s().sourceItemId)}</strong><small>{s().state} · {s().nextDate ?? "Waiting for completion"}</small></button>}</For></aside>
        <Show when={selected()}>{schedule => <div class="productivity-card"><h3>{title(schedule().sourceItemId)}</h3><p>{recurrenceLabel(schedule().definition)}</p><p>Next: {schedule().nextDate ?? "After the outstanding occurrence is completed"} · {schedule().definition.timezone}</p><Show when={schedule().lastError}><p role="alert">{schedule().lastError}</p></Show><div class="productivity-actions"><button onClick={() => panel.openItem(schedule().sourceItemId as Id<"items">)}>Edit schedule on source item</button><Show when={schedule().state !== "ended"}><button disabled={busy()} onClick={() => void control(schedule().state === "paused" ? "resume" : "pause")}>{schedule().state === "paused" ? "Resume" : "Pause"}</button><button disabled={busy()} onClick={() => void control("end")}>End repetition</button></Show></div><h4>Occurrence history</h4><ol class="productivity-preview"><For each={listOccurrences({ workspaceId: workspaceId(), scheduleId: schedule()._id })} keyed={o => o._id}>{occurrence => <li><button onClick={() => panel.openItem(occurrence().itemId as Id<"items">)}>{title(occurrence().itemId)}</button><small>{occurrence().scheduledDate} · {occurrence().state}{occurrence().completedAt ? ` · ${new Date(occurrence().completedAt!).toLocaleDateString()}` : ""}</small></li>}</For></ol></div>}</Show>
      </div>
    </Show>
  </section>;
}
