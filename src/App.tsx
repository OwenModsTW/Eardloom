import { useEffect } from "react";
import { useStore } from "./store";
import { startUpdateChecks } from "./lib/updater";
import { Home } from "./components/Home";
import { Shell } from "./components/Shell";
import { UpdateBanner, UpdatePrompt } from "./components/UpdateBanner";
import { WhatsNew } from "./components/WhatsNew";
import { ContextMenuHost } from "./components/ContextMenu";

export default function App() {
  const world = useStore((s) => s.world);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!import.meta.env.DEV) return startUpdateChecks();
  }, []);

  return (
    <div className="app">
      <UpdateBanner />
      {world ? <Shell /> : <Home />}
      {toast && <div className="toast">{toast}</div>}
      <UpdatePrompt />
      <WhatsNew />
      <ContextMenuHost />
    </div>
  );
}
