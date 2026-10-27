import { render } from "@solidjs/web";
import "./index.css";
import { LocalProvider } from "./local/provider";
import { Router } from "./router";

const root = document.getElementById("root");
render(
  () => (
    <LocalProvider>
      <Router>{(props) => props.children}</Router>
    </LocalProvider>
  ),
  root!,
);
