import { useEffect, useState } from "react";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../store";
import { buildSite } from "../lib/export/site";

type Mode = "site" | "pack";

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, "").trim() || "World";

/** Share a whole world: as a wiki website, or as a world pack another Eardloom can open. */
export function ShareWorld({ onClose }: { onClose: () => void }) {
  const { world, types, notify } = useStore();
  const [mode, setMode] = useState<Mode>("site");
  const [includeSpoilers, setIncludeSpoilers] = useState(true);
  const [omitPrivate, setOmitPrivate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, busy]);

  if (!world) return null;

  const exportSite = async () => {
    const parent = await openDialog({ directory: true, title: "Choose where to put the website folder" });
    if (typeof parent !== "string") return;
    setBusy("Building pages…");
    try {
      const base = `${parent}/${safeName(world.name)} wiki`;
      let dir = base;
      for (let n = 2; await exists(dir); n++) dir = `${base} (${n})`;
      const { files, assets, count } = await buildSite(world, types, { includeSpoilers });
      setBusy("Writing files…");
      const index = await api.writeStaticSite(dir, files, assets);
      notify(`Website created with ${count} entries`);
      await openPath(index).catch(() => revealItemInDir(index));
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  const exportPack = async () => {
    const dest = await save({
      defaultPath: `${safeName(world.name)}.eardloom`,
      filters: [{ name: "Eardloom world", extensions: ["eardloom"] }],
    });
    if (!dest) return;
    setBusy("Packing world…");
    try {
      await api.exportWorldPack(dest, omitPrivate);
      notify("World pack saved");
      revealItemInDir(dest).catch(() => {});
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <div className="dialog share-world" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Share world">
        <header className="dialog-head">
          <h2>Share {world.name}</h2>
        </header>
        <div className="share-world-body">
          <div className="format-list">
            <button className={mode === "site" ? "on" : ""} onClick={() => setMode("site")}>
              <strong>Wiki website</strong>
              <small>
                A folder of web pages anyone can open in a browser, no Eardloom needed. Upload it to Netlify Drop or GitHub
                Pages to share a link.
              </small>
            </button>
            <button className={mode === "pack" ? "on" : ""} onClick={() => setMode("pack")}>
              <strong>World pack</strong>
              <small>The whole world in one .eardloom file, for another Eardloom user or for a backup.</small>
            </button>
          </div>

          {mode === "site" ? (
            <>
              <label className="check">
                <input type="checkbox" checked={includeSpoilers} onChange={(e) => setIncludeSpoilers(e.target.checked)} />
                <span>
                  Include spoiler entries
                  <small>They're hidden behind a “Reveal” button. Untick to leave them out entirely.</small>
                </span>
              </label>
              <p className="hint">
                Private entries are never included. Links to anything left out become plain text, and only images used by the
                included entries are copied.
              </p>
            </>
          ) : (
            <label className="check">
              <input type="checkbox" checked={omitPrivate} onChange={(e) => setOmitPrivate(e.target.checked)} />
              <span>
                Leave out private entries
                <small>Untick for a full backup that includes everything.</small>
              </span>
            </label>
          )}
        </div>
        <footer className="dialog-foot">
          {error ? <span className="error-text">{error}</span> : busy ? <span className="hint">{busy}</span> : <span />}
          <span className="spacer" />
          <button className="ghost" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          <button className="primary" disabled={!!busy} onClick={mode === "site" ? exportSite : exportPack}>
            {mode === "site" ? "Create website…" : "Save world pack…"}
          </button>
        </footer>
      </div>
    </div>
  );
}
