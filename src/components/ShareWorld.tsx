import { useEffect, useState } from "react";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { exists, writeFile } from "@tauri-apps/plugin-fs";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../store";
import { buildSite } from "../lib/export/site";
import { buildSingleFile } from "../lib/export/single";
import { worldGuideDocx, worldGuideMarkdown, worldGuidePdf } from "../lib/export/entry";
import type { Entry } from "../lib/types";

type Mode = "file" | "guide" | "site" | "pack";
type GuideFormat = "pdf" | "docx" | "md";

const GUIDE: Record<GuideFormat, { ext: string; name: string }> = {
  pdf: { ext: "pdf", name: "PDF" },
  docx: { ext: "docx", name: "Word document" },
  md: { ext: "md", name: "Markdown" },
};

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, "").trim() || "World";

/** Share a whole world: one file anyone can open, a printable guide, a website, or a world pack for Eardloom. */
export function ShareWorld({ onClose }: { onClose: () => void }) {
  const { world, types, notify } = useStore();
  const [mode, setMode] = useState<Mode>("file");
  const [format, setFormat] = useState<GuideFormat>("pdf");
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
      const { files, assets, count } = await buildSite(world, types, { includeSpoilers }, useStore.getState().calendar);
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

  // One .html file with every shared page, the search and the images inside it.
  const exportFile = async () => {
    const dest = await save({ defaultPath: `${safeName(world.name)}.html`, filters: [{ name: "Web page", extensions: ["html"] }] });
    if (!dest) return;
    setBusy("Building pages…");
    try {
      const { html, count } = await buildSingleFile(world, types, { includeSpoilers }, useStore.getState().calendar);
      setBusy("Saving…");
      await writeFile(dest, new TextEncoder().encode(html));
      notify(`Saved ${count} entries in one file`);
      revealItemInDir(dest).catch(() => {});
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  // Every shared entry, grouped by category, as a document to read or print.
  const exportGuide = async () => {
    const f = GUIDE[format];
    const dest = await save({ defaultPath: `${safeName(world.name)} guide.${f.ext}`, filters: [{ name: f.name, extensions: [f.ext] }] });
    if (!dest) return;
    setBusy("Gathering entries…");
    try {
      const all: Entry[] = [];
      for (const e of useStore.getState().entries) all.push(await api.getEntry(e.id));
      const shared = all.filter((e) => e.visibility === "public" || (includeSpoilers && e.visibility === "spoiler"));
      setBusy(`Making ${f.name}…`);
      const title = `${world.name}`;
      const bytes =
        format === "pdf"
          ? await worldGuidePdf(title, shared)
          : format === "docx"
            ? await worldGuideDocx(title, shared)
            : new TextEncoder().encode(worldGuideMarkdown(title, shared));
      await writeFile(dest, bytes);
      notify(`World guide saved with ${shared.length} entries`);
      revealItemInDir(dest).catch(() => {});
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
            <button className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
              <strong>One file to send</strong>
              <small>
                Your world as a single web page file. Send it like any attachment; it opens in any browser, on a computer or
                phone, with search, links and pictures, no Eardloom or internet needed.
              </small>
            </button>
            <button className={mode === "guide" ? "on" : ""} onClick={() => setMode("guide")}>
              <strong>World guide</strong>
              <small>Every shared entry, grouped by category, as a PDF, Word document or Markdown file to read or print.</small>
            </button>
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

          {mode === "guide" && (
            <div className="segmented">
              {(Object.keys(GUIDE) as GuideFormat[]).map((k) => (
                <button key={k} className={format === k ? "on" : ""} onClick={() => setFormat(k)}>
                  {GUIDE[k].name}
                </button>
              ))}
            </div>
          )}
          {mode !== "pack" ? (
            <>
              <label className="check">
                <input type="checkbox" checked={includeSpoilers} onChange={(e) => setIncludeSpoilers(e.target.checked)} />
                <span>
                  Include spoiler entries
                  <small>
                    {mode === "guide" ? "Untick to leave them out." : "They're hidden behind a “Reveal” button. Untick to leave them out entirely."}
                  </small>
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
          <button
            className="primary"
            disabled={!!busy}
            onClick={mode === "file" ? exportFile : mode === "guide" ? exportGuide : mode === "site" ? exportSite : exportPack}
          >
            {mode === "file" ? "Save file…" : mode === "guide" ? `Save ${GUIDE[format].name}…` : mode === "site" ? "Create website…" : "Save world pack…"}
          </button>
        </footer>
      </div>
    </div>
  );
}
