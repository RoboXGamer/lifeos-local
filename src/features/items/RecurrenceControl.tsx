import { createEffect, createSignal, For, Show } from "solid-js";
import { api } from "../../local/api";
import { listOccurrences, recurrenceLabel, scheduleForItem, type RecurrenceDefinition } from "../../local/recurrence";
import type { ItemView } from "../../local/types";
import { localDateKey } from "./dates";
import "../../pages/Productivity.css";

export function RecurrenceControl(props: { item: ItemView }) {
  const schedule = () => scheduleForItem(props.item._id);
  const [frequency, setFrequency] = createSignal<RecurrenceDefinition["frequency"]>("weekly");
  const [mode, setMode] = createSignal<RecurrenceDefinition["mode"]>("calendar");
  const [interval, setInterval] = createSignal(1);
  const [weekdays, setWeekdays] = createSignal<number[]>([1, 2, 3, 4, 5]);
  const [startDate, setStartDate] = createSignal(props.item.dueDate ?? localDateKey());
  const [endDate, setEndDate] = createSignal("");
  const [timezone, setTimezone] = createSignal(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [snooze, setSnooze] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  createEffect(() => `${props.item._id}:${schedule()?.updatedAt ?? 0}`, () => {
    const definition = schedule()?.definition;
    setFrequency(definition?.frequency ?? "weekly"); setMode(definition?.mode ?? "calendar"); setInterval(definition?.interval ?? 1);
    setWeekdays(definition?.weekdays ?? [1, 2, 3, 4, 5]); setStartDate(definition?.startDate ?? props.item.dueDate ?? localDateKey());
    setEndDate(definition?.endDate ?? ""); setTimezone(definition?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone); setMessage("");
  });
  const perform = async (work: () => Promise<unknown>, success: string) => {
    if (busy()) return; setBusy(true); setMessage("");
    try { await work(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not update repetition."); }
    finally { setBusy(false); }
  };
  const control = (action: "pause" | "resume" | "end" | "skip" | "snooze") => {
    const current = schedule(); if (!current) return;
    void perform(() => api.recurrence.control({ workspaceId: props.item.workspaceId, scheduleId: current._id, action, date: snooze() || undefined }), action === "skip" ? "Occurrence skipped; history kept." : "Repetition updated.");
  };
  const pending = () => listOccurrences({ workspaceId: props.item.workspaceId, scheduleId: schedule()?._id }).find(o => o.state === "pending");
  return <details class="productivity-control">
    <summary>{schedule() ? `Repeats · ${schedule()!.state}` : "Repeat this item"}</summary>
    <Show when={schedule()}>{s => <><p>{recurrenceLabel(s().definition)}</p><small>Next: {s().nextDate ?? "after the outstanding occurrence is completed"} · {s().definition.timezone}</small><Show when={s().lastError}><p role="alert">{s().lastError}</p></Show></>}</Show>
    <form onSubmit={e => {
      e.preventDefault(); const current = schedule();
      void perform(() => api.recurrence.save({ workspaceId: props.item.workspaceId, itemId: props.item._id, scheduleId: current?._id, definition: { frequency: frequency(), mode: mode(), interval: interval(), weekdays: weekdays(), startDate: startDate(), endDate: endDate() || null, timezone: timezone() } }), "Schedule saved. Completion history stays with the schedule.");
    }}>
      <label>Repeat<select value={frequency()} onChange={e => setFrequency(e.currentTarget.value as RecurrenceDefinition["frequency"])}><option value="daily">Daily</option><option value="weekdays">Selected weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="interval">Every N days</option></select></label>
      <Show when={frequency() !== "daily" && frequency() !== "weekdays"}><label>Every<input type="number" min={1} max={365} required value={interval()} onInput={e => setInterval(Number(e.currentTarget.value))} /></label></Show>
      <Show when={frequency() === "weekdays"}><fieldset><legend>Weekdays</legend><For each={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}>{(name, index) => <label style={{ display: "inline-flex", "align-items": "center", "margin-right": "8px" }}><input style={{ width: "auto" }} type="checkbox" checked={weekdays().includes(index())} onChange={e => setWeekdays(e.currentTarget.checked ? [...weekdays(), index()] : weekdays().filter(d => d !== index()))} />{name}</label>}</For></fieldset></Show>
      <label>Timing<select value={mode()} onChange={e => setMode(e.currentTarget.value as RecurrenceDefinition["mode"])}><option value="calendar">Keep calendar dates</option><option value="completion">Count from completion</option></select></label>
      <label>Starts<input type="date" required value={startDate()} onInput={e => setStartDate(e.currentTarget.value)} /></label>
      <label>Ends (optional)<input type="date" value={endDate()} min={startDate()} onInput={e => setEndDate(e.currentTarget.value)} /></label>
      <label>Timezone<input required value={timezone()} onInput={e => setTimezone(e.currentTarget.value)} /></label>
      <small>Monthly repetition clamps to the last day of short months. Missed dates become one outstanding item. Financial entries start Planned or Expected.</small>
      <button disabled={busy()} type="submit">{busy() ? "Saving…" : schedule() ? "Save schedule changes" : "Start repeating"}</button>
    </form>
    <Show when={schedule() && schedule()!.state !== "ended"}><div class="productivity-actions"><button disabled={busy()} onClick={() => control(schedule()!.state === "paused" ? "resume" : "pause")}>{schedule()!.state === "paused" ? "Resume" : "Pause"}</button><button disabled={busy() || !pending()} onClick={() => control("skip")}>Skip current</button><button disabled={busy()} onClick={() => control("end")}>End repetition</button></div><label>Snooze until<input type="date" value={snooze()} onInput={e => setSnooze(e.currentTarget.value)} /></label><button disabled={busy() || !snooze()} onClick={() => control("snooze")}>Snooze</button></Show>
    <p role="status">{message()}</p>
    <Show when={schedule()}><a href="/app/recurring">View schedule history</a></Show>
  </details>;
}
