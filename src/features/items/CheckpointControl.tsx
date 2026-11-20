import { createSignal } from "solid-js";
import { api } from "../../local/api";
import type { ItemView } from "../../local/types";
import "../../pages/Productivity.css";

export function CheckpointControl(props: { item: ItemView }) {
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  return <details class="productivity-control"><summary>Save a project checkpoint</summary><form onSubmit={async event => {
    event.preventDefault(); if (busy()) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      await api.automations.checkpoint({ workspaceId: props.item.workspaceId, itemId: props.item._id, did: String(values.get("did") ?? ""), failed: String(values.get("failed") ?? ""), next: String(values.get("next") ?? "") });
      form.reset(); setMessage("Checkpoint saved as a child note. Your next step is preserved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save checkpoint."); }
    finally { setBusy(false); }
  }}><label>What changed<textarea name="did" rows={3} maxlength={5000} required placeholder="What did you finish or learn?" /></label><label>What failed<textarea name="failed" rows={2} maxlength={5000} placeholder="Failed attempts and blockers" /></label><label>Next action<textarea name="next" rows={2} maxlength={5000} required placeholder="The exact next action when you return" /></label><button disabled={busy()}>{busy() ? "Saving…" : "Save checkpoint"}</button><small role="status">{message()}</small></form></details>;
}
