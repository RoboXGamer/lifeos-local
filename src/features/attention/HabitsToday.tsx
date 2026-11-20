import { createSignal, For, Show } from "solid-js";
import { api } from "../../local/api";
import { data } from "../../local/store";
import { useWorkspaces } from "../workspaces/context";
import { zonedDate } from "../../local/recurrence";
import "./HabitsToday.css";

export function HabitsToday(props: { now: number }) {
  const statusLabels: Record<string, string> = { done: "Target met", partial: "In progress", unlogged: "Not logged", rest: "Rest day", skipped: "Skipped", paused: "Paused" };
  const workspaces = useWorkspaces();
  const workspaceId = () => workspaces.state.activeWorkspaceId;
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const habits = () => workspaceId() ? api.habits.list({ workspaceId: workspaceId()! }).filter(h => h.state === "active") : [];
  const act = async (work: () => Promise<unknown>, success: string) => {
    if (busy()) return;
    setBusy(true); setMessage("");
    try { await work(); setMessage(success); } catch (e) { setMessage(e instanceof Error ? e.message : "Could not save check-in."); } finally { setBusy(false); }
  };
  return <Show when={workspaceId() && data.workspaces.some(w => w._id === workspaceId() && !w.archived)}><section class="habits-today" aria-label="Habits today">
    <header><div><h3>Habits today</h3><p>Log what you did. Active linked goals update during their date range.</p></div><a href="/app/habits">Habits &amp; progress</a></header>
    <Show when={message()}><p role="status">{message()}</p></Show>
    <div class="habits-today-list"><For each={habits()} keyed={h => h._id} fallback={<p>No active habits yet. <a href="/app/habits">Set up a habit</a>.</p>}>{habit => {
      const today = () => zonedDate(props.now, habit().timezone);
      const details = () => api.habits.details({ workspaceId: workspaceId()!, habitId: habit()._id, date: today() });
      return <article class="habit-today-card"><div><strong>{habit().title}</strong><small>{details().todayValue} / {details().todayTarget} {habit().unit} today · {details().weekDaysMet} / {details().weekTarget} days this week</small><small>{statusLabels[details().todayStatus] ?? details().todayStatus}</small></div>
        <form onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); const value = Number(values.get("value")); const id = crypto.randomUUID(); void act(() => api.activity.log({ workspaceId: workspaceId()!, activityId: id, habitId: habit()._id, value, mode: "increment", date: today() }), "Activity logged. Eligible linked goals reflect it."); }}><label><span class="habit-sr-only">Amount for {habit().title}</span><input name="value" aria-label={`Amount for ${habit().title}`} type="number" min="0.01" step="any" value={habit().unit === "times" ? 1 : ""} placeholder={habit().unit} required /></label><button disabled={busy()}>Log</button></form>
        <details><summary>Rest or skip</summary><div><button disabled={busy()} onClick={() => void act(() => api.habits.mark({ workspaceId: workspaceId()!, habitId: habit()._id, date: today(), status: "rest" }), "Rest day recorded.")}>Rest day</button><button disabled={busy()} onClick={() => void act(() => api.habits.mark({ workspaceId: workspaceId()!, habitId: habit()._id, date: today(), status: "skip" }), "Skip recorded.")}>Skip</button><button disabled={busy()} onClick={() => void act(() => api.habits.mark({ workspaceId: workspaceId()!, habitId: habit()._id, date: today(), status: "clear" }), "Day status cleared.")}>Clear status</button></div></details>
      </article>;
    }}</For></div>
  </section></Show>;
}
