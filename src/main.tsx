import React from "react";
import ReactDOM from "react-dom/client";
// Literata with optical sizing: tighter at heading sizes, roomier for body text.
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import App from "./App";
import { applyAppearance } from "./lib/theme";
import "./styles.css";

applyAppearance();

// This is a desktop app: suppress the webview's own right-click menu (Reload, Inspect...)
// everywhere except text fields, where it provides spellcheck and copy/paste.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
