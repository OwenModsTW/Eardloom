import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../store";
import { canvasToPng, fieldText, renderCard, saveCardPrefs, savedCardPrefs, type CardLayout, type CardOptions, type CardTheme } from "../lib/export/card";
import type { Entry } from "../lib/types";


/** Renders an entry as a presentable image to save or paste into a chat. */
export function ShareCard({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const type = useStore((s) => s.types.find((t) => t.id === entry.typeId));
  const notify = useStore((s) => s.notify);
  const prefs = useMemo(savedCardPrefs, []);

  // Offer only fields that have something in them; pre-tick the first few short ones.
  const filled = useMemo(
    () => (type?.fields ?? []).filter((f) => fieldText(entry.fields[f.id], f.kind)),
    [type, entry],
  );
  const [fieldIds, setFieldIds] = useState<string[]>(() =>
    filled.filter((f) => f.kind !== "longtext").slice(0, 6).map((f) => f.id),
  );
  const [layout, setLayout] = useState<CardLayout>(prefs.layout ?? "portrait");
  const [theme, setTheme] = useState<CardTheme>(prefs.theme ?? "dark");
  const [showSummary, setShowSummary] = useState(prefs.showSummary ?? true);
  const [showWorld, setShowWorld] = useState(prefs.showWorld ?? true);
  const [preview, setPreview] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  const opts: CardOptions = { layout, theme, fieldIds, showSummary, showWorld };

  useEffect(() => {
    let alive = true;
    renderCard(entry, type, opts).then((c) => {
      if (!alive) return;
      canvas.current = c;
      setPreview(c.toDataURL("image/png"));
    });
    saveCardPrefs({ layout, theme, showSummary, showWorld });
    return () => {
      alive = false;
    };
  }, [layout, theme, showSummary, showWorld, fieldIds.join()]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const savePng = async () => {
    if (!canvas.current) return;
    const path = await save({
      defaultPath: `${(entry.title || "entry").replace(/[<>:"/\\|?*]/g, "").trim()}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!path) return;
    await writeFile(path, new Uint8Array(await (await canvasToPng(canvas.current)).arrayBuffer()));
    notify("Image saved");
    onClose();
  };

  const copy = async () => {
    if (!canvas.current) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": canvasToPng(canvas.current) })]);
      notify("Copied. Paste it into any chat.");
      onClose();
    } catch (e) {
      notify(`Couldn't copy: ${String(e)}`);
    }
  };

  const toggleField = (id: string) =>
    setFieldIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].sort((a, b) => filled.findIndex((f) => f.id === a) - filled.findIndex((f) => f.id === b))));

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog share" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Share as image">
        <header className="dialog-head">
          <h2>Share “{entry.title || "Unnamed"}”</h2>
        </header>
        <div className="share-body">
          <div className={`share-preview ${layout}`}>{preview && <img src={preview} alt="Card preview" />}</div>
          <div className="share-options">
            <span className="field-label">Layout</span>
            <div className="segmented">
              <button className={layout === "portrait" ? "on" : ""} onClick={() => setLayout("portrait")}>
                Portrait
              </button>
              <button className={layout === "banner" ? "on" : ""} onClick={() => setLayout("banner")}>
                Banner
              </button>
            </div>
            <span className="field-label">Theme</span>
            <div className="segmented">
              <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>
                Lamplit
              </button>
              <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>
                Daylight
              </button>
            </div>
            <span className="field-label">Show</span>
            <label className="check">
              <input type="checkbox" checked={showSummary} onChange={(e) => setShowSummary(e.target.checked)} />
              <span>Summary</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={showWorld} onChange={(e) => setShowWorld(e.target.checked)} />
              <span>World name</span>
            </label>
            {filled.length > 0 && <span className="field-label">Fields</span>}
            {filled.map((f) => (
              <label key={f.id} className="check">
                <input type="checkbox" checked={fieldIds.includes(f.id)} onChange={() => toggleField(f.id)} />
                <span>{f.label}</span>
              </label>
            ))}
            {entry.visibility !== "public" && (
              <p className="share-warning">
                This entry is marked {entry.visibility}. Check the card doesn't give anything away before sharing it.
              </p>
            )}
          </div>
        </div>
        <footer className="dialog-foot">
          <span className="hint">{layout === "portrait" ? "1080 × 1350" : "1600 × 900"} PNG</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="ghost" onClick={copy} disabled={!preview}>
            Copy image
          </button>
          <button className="primary" onClick={savePng} disabled={!preview}>
            Save PNG…
          </button>
        </footer>
      </div>
    </div>
  );
}
