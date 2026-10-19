import { useEffect } from "react";
import { useStore } from "./store";
import { startUpdateChecks } from "./lib/updater";
import { backupOnClose } from "./lib/backup";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Home } from "./components/Home";
import { Shell } from "./components/Shell";
import { UpdateBanner, UpdatePrompt } from "./components/UpdateBanner";
import { WhatsNew } from "./components/WhatsNew";
import { PromptHost } from "./components/Prompt";
import { ContextMenuHost } from "./components/ContextMenu";
import { AiProposals } from "./components/AiProposals";
import { syncAiPrivacy } from "./components/AiSettings";

export default function App() {
  const world = useStore((s) => s.world);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!import.meta.env.DEV) return startUpdateChecks();
  }, []);
  useEffect(() => {
    syncAiPrivacy();
  }, []);

  // Closing the window: one last backup (skipped if nothing changed), then close.
  useEffect(() => {
    const win = getCurrentWindow();
    const off = win.onCloseRequested(async (event) => {
      if (!useStore.getState().world) return;
      event.preventDefault();
      await Promise.race([backupOnClose(), new Promise((r) => setTimeout(r, 15_000))]);
      await win.destroy();
    });
    return () => void off.then((f) => f());
  }, []);

  return (
    <div className="app">
      <UpdateBanner />
      {world ? <Shell /> : <Home />}
      {toast && <div className="toast">{toast}</div>}
      <UpdatePrompt />
      <WhatsNew />
      <AiProposals />
      <ContextMenuHost />
      <PromptHost />
    </div>
  );
}
