import { createSignal } from "solid-js";
import { api } from "../../local/api";
import type { ItemView } from "../../local/types";
import { localDateKey } from "./dates";
import "../../pages/Productivity.css";

export function TemplateSaveControl(props: { item: ItemView }) {
  const [message, setMessage] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  return <details class="productivity-control"><summary>Save family as template</summary><form onSubmit={async e => {
    e.preventDefault(); if (busy()) return;
    const values = new FormData(e.currentTarget);
    setBusy(true); setMessage("");
    try { await api.templates.saveFamily({ workspaceId: props.item.workspaceId, itemId: props.item._id, name: String(values.get("name")), startDate: String(values.get("date")) }); setMessage("Saved. Find it in Templates."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save template."); }
    finally { setBusy(false); }
  }}><label>Template name<input name="name" value={props.item.title} maxlength={80} required /></label><label>Relative dates start from<input type="date" name="date" value={localDateKey()} required /></label><button disabled={busy()}>{busy() ? "Saving…" : "Save template"}</button><small role="status">{message()}</small></form></details>;
}
