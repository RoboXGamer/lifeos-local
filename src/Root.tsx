import "./index.css";
import { LocalProvider } from "./local/provider";
import { Router } from "./router";

export default function Root() {
  return <LocalProvider><Router>{(props) => props.children}</Router></LocalProvider>;
}
