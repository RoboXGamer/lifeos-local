import { createSignal, onSettled } from "solid-js";
import "./Avatar.css";

interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: number;
}

function Avatar(props: AvatarProps) {
  const [status, setStatus] = createSignal<"loading" | "loaded" | "error">(
    "loading",
  );
  const size = () => props.size ?? 24;

  onSettled(() => {
    if (!props.src) {
      setStatus("error");
      return;
    }
    const img = new window.Image();
    img.onload = () => setStatus("loaded");
    img.onerror = () => setStatus("error");
    img.src = props.src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  });

  return (
    <div
      class="avatar"
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        "font-size": `${Math.round(size() * 0.45)}px`,
      }}
    >
      {status() === "loaded" ? (
        <img src={props.src} alt={props.alt ?? ""} />
      ) : (
        <span class="avatar-fallback">{props.fallback ?? "?"}</span>
      )}
    </div>
  );
}

export default Avatar;
