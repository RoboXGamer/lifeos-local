import { Show, createSignal, onSettled } from "solid-js";

type Status = "disabled" | "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "installing" | "failed";
type Report = { status: Status; version: string; message: string };
type Action = "status" | "check" | "download" | "install";

export function UpdateControl() {
  const [report, setReport] = createSignal<Report>({ status: "disabled", version: "", message: "" });
  const send = (action: Action) => {
    const desktop = window as Window & { __electrobunSendToHost?: (message: string) => void };
    desktop.__electrobunSendToHost?.(`lifeos:updates:${action}`);
  };

  onSettled(() => {
    const listener = (event: Event) => setReport((event as CustomEvent<Report>).detail);
    window.addEventListener("lifeos-update", listener);
    send("status");
    return () => window.removeEventListener("lifeos-update", listener);
  });

  const button = () => {
    switch (report().status) {
      case "checking": return "Checking…";
      case "available": return `Download ${report().version}`;
      case "downloading": return "Downloading…";
      case "ready": return "Restart to update";
      case "installing": return "Installing…";
      default: return "Check for updates";
    }
  };

  const onClick = () => {
    switch (report().status) {
      case "available": return send("download");
      case "ready": return send("install");
      default: return send("check");
    }
  };

  return (
    <Show when={report().status !== "disabled"}>
      <div class="desktop-update">
        <button type="button" disabled={["checking", "downloading", "installing"].includes(report().status)} onClick={onClick}>
          {button()}
        </button>
        <span role="status">
          {report().status === "current" ? "Up to date" : report().status === "failed" ? report().message : ""}
        </span>
      </div>
    </Show>
  );
}
