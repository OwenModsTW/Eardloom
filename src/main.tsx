import React from "react";
import ReactDOM from "react-dom/client";
// Literata with optical sizing: tighter at heading sizes, roomier for body text.
import "@fontsource-variable/literata/opsz.css";
import "@fontsource-variable/literata/opsz-italic.css";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import App from "./App";
import { applyAppearance } from "./lib/theme";
import { applyManuscriptLook } from "./lib/prefs";
import "./styles.css";

applyAppearance();
applyManuscriptLook();

// This is a desktop app: suppress the webview's own right-click menu (Reload, Inspect...)
// everywhere except text fields, where it provides spellcheck and copy/paste.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
});

const start = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// The automatic page tests run the app against a stand-in backend (never in a real build).
if (import.meta.env.MODE === "smoke") import("./smoke/mock").then(start);
else start();
