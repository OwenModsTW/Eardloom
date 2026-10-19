import { useEffect, useMemo, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { useStore } from "../store";
import { loadGraph } from "../lib/graph";
import { buildFamily, familyTree, fieldsById, type LinkRow } from "../lib/relations";
import { EntryGlyph } from "./EntryIcon";

const CARD_W = 150;
const CARD_H = 50;
const GAP_X = 22;
const GAP_Y = 64;
const PAD = 24;

const ROW_NAMES = ["Grandparents", "Parents", "", "Children", "Grandchildren"];

/** A family tree around one entry, from every family field in the world. Click anyone to centre on them. */
export function FamilyTree({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { entries, types, go } = useStore();
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [focus, setFocus] = useState(entryId);

  useEffect(() => {
    loadGraph().then((g) => setLinks(g.links));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const fields = useMemo(() => fieldsById(types), [types]);
  const hasFamilyFields = useMemo(() => [...fields.values()].some((f) => f.family), [fields]);
  const tree = useMemo(() => (links ? familyTree(buildFamily(links, fields), focus) : null), [links, fields, focus]);

  const layout = useMemo(() => {
    if (!tree) return null;
    const widest = Math.max(1, ...tree.rows.map((r) => r.length));
    const width = PAD * 2 + widest * CARD_W + (widest - 1) * GAP_X;
    const pos = new Map<string, { x: number; y: number }>();
    const rowsShown = tree.rows.map((r, i) => ({ ids: r, i })).filter((r) => r.ids.length || r.i === 2);
    rowsShown.forEach((row, j) => {
      const rowWidth = row.ids.length * CARD_W + (row.ids.length - 1) * GAP_X;
      const x0 = (width - rowWidth) / 2;
      row.ids.forEach((id, k) => pos.set(id, { x: x0 + k * (CARD_W + GAP_X), y: PAD + 18 + j * (CARD_H + GAP_Y) }));
    });
    const height = PAD * 2 + 18 + rowsShown.length * CARD_H + (rowsShown.length - 1) * GAP_Y;
    return { width, height, pos, rowsShown };
  }, [tree]);

  const person = entries.find((e) => e.id === focus);
  const alone = tree && tree.rows.every((r, i) => (i === 2 ? r.length === 1 : r.length === 0));

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog family" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Family tree">
        <header className="dialog-head row">
          <h2>Family of {person?.title ?? "this entry"}</h2>
          <span className="spacer" />
          {focus !== entryId && (
            <button className="link quiet" onClick={() => setFocus(entryId)}>
              Back to {entries.find((e) => e.id === entryId)?.title}
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="family-body">
          {!hasFamilyFields ? (
            <p className="hint family-note">
              Family trees come from link fields marked as Parents, Children, Partners or Siblings. Set that up in the category's
              fields (Settings for the category → a link field → Family tree).
            </p>
          ) : !layout || !tree ? (
            <p className="hint family-note">Loading…</p>
          ) : (
            <>
              {alone && <p className="hint family-note">No family linked yet. Fill in a family field (such as Parents) on this entry or a relative's.</p>}
              <div className="family-canvas" style={{ width: layout.width, height: layout.height }}>
                <svg width={layout.width} height={layout.height}>
                  {tree.lines.map((l, i) => {
                    const a = layout.pos.get(l.from);
                    const b = layout.pos.get(l.to);
                    if (!a || !b) return null;
                    if (l.kind === "partner")
                      return (
                        <line key={i} className="family-partner" x1={a.x + CARD_W / 2} y1={a.y + CARD_H / 2} x2={b.x + CARD_W / 2} y2={b.y + CARD_H / 2} />
                      );
                    const x1 = a.x + CARD_W / 2;
                    const y1 = a.y + CARD_H;
                    const x2 = b.x + CARD_W / 2;
                    const y2 = b.y;
                    const mid = (y1 + y2) / 2;
                    return <path key={i} className="family-line" d={`M${x1},${y1} V${mid} H${x2} V${y2}`} />;
                  })}
                </svg>
                {layout.rowsShown.map((row, j) =>
                  ROW_NAMES[row.i] ? (
                    <span key={row.i} className="family-row-name" style={{ top: PAD + j * (CARD_H + GAP_Y) - 2 }}>
                      {ROW_NAMES[row.i]}
                    </span>
                  ) : null,
                )}
                {[...layout.pos].map(([id, p]) => {
                  const e = entries.find((x) => x.id === id);
                  return (
                    <div key={id} className={`family-card ${id === focus ? "focus" : ""}`} style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}>
                      <button className="family-main" onClick={() => setFocus(id)} title="Centre the tree on them">
                        <EntryGlyph entry={e} size={15} />
                        <span>{e?.title ?? "Unknown"}</span>
                      </button>
                      <button className="icon-btn family-open" onClick={() => (onClose(), go({ view: "entry", id }))} title="Open entry">
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
