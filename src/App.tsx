import { useEffect } from "react";
import { useStore } from "./store";
import { useUpdater } from "./lib/updater";
import { Home } from "./components/Home";
import { Shell } from "./components/Shell";
import { UpdateBanner } from "./components/UpdateBanner";
import { ContextMenuHost } from "./components/ContextMenu";

export default function App() {
  const world = useStore((s) => s.world);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    if (!import.meta.env.DEV) useUpdater.getState().checkNow(true);
  }, []);

  return (
    <div className="app">
      <UpdateBanner />
      {world ? <Shell /> : <Home />}
      {toast && <div className="toast">{toast}</div>}
      <ContextMenuHost />
    </div>
  );
}
