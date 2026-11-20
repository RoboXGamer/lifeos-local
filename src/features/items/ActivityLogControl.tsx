import { createEffect, createSignal, For, Show } from "solid-js";
import { nanoid } from "nanoid";
import { api } from "../../local/api";
import type { ItemView } from "../../local/types";
import { localDateKey } from "./dates";
import "../../pages/Productivity.css";

/** Record effort against a task without implicitly marking the task complete. */
export function ActivityLogControl(props: { item: ItemView }) {
  const [habitId, setHabitId] = createSignal("");
  const [goalId, setGoalId] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal("");
  createEffect(() => props.item._id, () => { setHabitId(""); setGoalId(""); setMessage(""); });
  const habits = () => api.habits.list({ workspaceId: props.item.workspaceId });
  const goals = () => api.goals.list({ workspaceId: props.item.workspaceId });
  const chosenHabit = () => habits().find(habit => habit._id === habitId());
  const compatibleGoals = () => goals().filter(goal => !chosenHabit() || goal.unit === chosenHabit()!.unit);
  return <details class="productivity-control">
    <summary>Log activity toward a habit or goal</summary>
    <p>Record what you actually did. Completing this task remains a separate choice.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (busy()) return;
      const form = new FormData(event.currentTarget);
      const selectedHabit = habitId(), selectedGoal = goalId();
      if (!selectedHabit && !selectedGoal) { setMessage("Choose a habit or a goal."); return; }
      const value = Number(form.get("value"));
      const date = String(form.get("date") ?? "");
      setBusy(true); setMessage("");
      void api.activity.log({ workspaceId: props.item.workspaceId, activityId: nanoid(), itemId: props.item._id, habitId: selectedHabit || undefined, goalIds: selectedGoal ? [selectedGoal] : undefined, value, mode: "increment", date, note: String(form.get("note") ?? "") }).then(() => setMessage("Activity recorded. Linked progress updated."), error => setMessage(error instanceof Error ? error.message : "Could not record activity.")).finally(() => setBusy(false));
    }}>
      <label>Habit<select value={habitId()} onChange={event => { setHabitId(event.currentTarget.value); setGoalId(""); }}><option value="">No habit</option><For each={habits()} keyed={habit => habit._id}>{habit => <option value={habit()._id}>{habit().title} ({habit().unit})</option>}</For></select></label>
      <label>Goal{habitId() ? " (overrides the habit’s linked goals)" : ""}<select value={goalId()} onChange={event => setGoalId(event.currentTarget.value)}><option value="">{habitId() ? "Use habit’s linked goals" : "No goal"}</option><For each={compatibleGoals()} keyed={goal => goal._id}>{goal => <option value={goal()._id}>{goal().title} ({goal().unit})</option>}</For></select></label>
      <label>Amount{chosenHabit() ? ` (${chosenHabit()!.unit})` : ""}<input name="value" type="number" min="0.01" step="any" required /></label>
      <label>Date<input name="date" type="date" value={localDateKey()} required /></label>
      <label>Note (optional)<input name="note" maxlength={1000} /></label>
      <button disabled={busy()}>{busy() ? "Saving…" : "Record activity"}</button>
      <Show when={message()}><small role="status">{message()}</small></Show>
    </form>
  </details>;
}
