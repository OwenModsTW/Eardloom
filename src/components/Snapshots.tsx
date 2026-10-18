import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Camera } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { toParagraphs } from "../lib/text";
import { compareParagraphs } from "../lib/diff";
import { relativeTime } from "./EntryView";
import { openMenu } from "./ContextMenu";

type Snapshot = Awaited<ReturnType<typeof api.listSnapshots>>[number];

const stamp = (iso: string) => {
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** Saved versions of the open document: take, compare, restore. */
export function SnapshotPanel({
  docId,
  flush,
  onRestored,
  version,
}: {
  docId: string;
  /** Saves pending edits first, so snapshots and restores see the latest text. */
  flush: () => Promise<void>;
  onRestored: () => void;
  /** Bumped by the parent when a snapshot is taken elsewhere (Ctrl+S). */
  version: number;
}) {
  const notify = useStore((s) => s.notify);
  const [list, setList] = useState<Snapshot[]>([]);
  const [name, setName] = useState("");
  const [comparing, setComparing] = useState<Snapshot | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const reload = useCallback(() => api.listSnapshots(docId).then(setList), [docId]);
  useEffect(() => {
    reload();
  }, [reload, version]);

  const take = async () => {
    await flush();
    await api.createSnapshot(docId, name.trim());
    setName("");
    reload();
    notify("Snapshot saved");
  };

  const restore = async (s: Snapshot) => {
    const label = s.name || `the ${stamp(s.createdAt)} version`;
    if (!(await ask(`Replace this document's text with ${label}? Your current text is saved as a snapshot first, so you can undo this.`, { title: "Restore snapshot", kind: "warning" })))
      return;
    await flush();
    const doc = await api.getDoc(docId);
    await api.createSnapshot(docId, `Before restoring ${label}`);
    await api.saveDoc({ ...doc, body: await api.getSnapshotBody(s.id) });
    reload();
    onRestored();
    notify("Restored");
  };

  const menu = (e: React.MouseEvent, s: Snapshot) =>
    openMenu(e, [
      { label: "Compare with current", onClick: () => setComparing(s) },
      { label: "Restore this version…", onClick: () => restore(s) },
      { label: s.automatic ? "Keep and name…" : "Rename…", onClick: () => setRenaming(s.id) },
      "separator",
      { label: "Delete", danger: true, onClick: async () => (await api.deleteSnapshot(s.id), reload()) },
    ]);

  return (
    <aside className="lore snapshots">
      <h3 className="side-title">Snapshots</h3>
      <form className="snap-take" onSubmit={(e) => (e.preventDefault(), take())}>
        <input value={name} placeholder="Name (optional)" onChange={(e) => setName(e.target.value)} />
        <button className="primary" type="submit" title="Take a snapshot (Ctrl+S)">
          <Camera size={14} /> Take
        </button>
      </form>
      <p className="hint">Saves this chapter as it is now. Eardloom also keeps one automatically each time you start editing.</p>
      <ul className="snap-list">
        {list.map((s) => (
          <li key={s.id} onContextMenu={(e) => menu(e, s)}>
            {renaming === s.id ? (
              <input
                autoFocus
                defaultValue={s.name}
                onBlur={async (e) => (await api.renameSnapshot(s.id, e.target.value.trim()), setRenaming(null), reload())}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
              />
            ) : (
              <button className="snap-main" onClick={() => setComparing(s)} title="Compare with the current text">
                <strong className={s.automatic ? "auto" : ""}>{s.name || (s.automatic ? "Automatic" : "Snapshot")}</strong>
                <small>
                  {stamp(s.createdAt)} · {s.wordCount.toLocaleString()} words · {relativeTime(s.createdAt)}
                </small>
              </button>
            )}
            <button className="link quiet" onClick={(e) => menu(e, s)}>
              ⋯
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="hint">No snapshots yet.</p>}
      {comparing && <CompareDialog docId={docId} snapshot={comparing} flush={flush} onClose={() => setComparing(null)} onRestore={() => (setComparing(null), restore(comparing))} />}
    </aside>
  );
}

function CompareDialog({
  docId,
  snapshot,
  flush,
  onClose,
  onRestore,
}: {
  docId: string;
  snapshot: Snapshot;
  flush: () => Promise<void>;
  onClose: () => void;
  onRestore: () => void;
}) {
  const [result, setResult] = useState<ReturnType<typeof compareParagraphs> | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);

  useEffect(() => {
    (async () => {
      await flush();
      const [old, now] = await Promise.all([api.getSnapshotBody(snapshot.id), api.getDoc(docId)]);
      setResult(compareParagraphs(toParagraphs(old), toParagraphs(now.body)));
    })();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [snapshot.id, docId]);

  const unchanged = result && result.added === 0 && result.removed === 0;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog compare" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Compare">
        <header className="dialog-head">
          <h2>
            {snapshot.name || "Snapshot"} <span className="hint">({stamp(snapshot.createdAt)}) compared with now</span>
          </h2>
        </header>
        <div className="compare-body">
          {!result ? (
            <p className="hint">Comparing…</p>
          ) : unchanged ? (
            <p className="hint">No differences. The text is the same as this snapshot.</p>
          ) : (
            result.blocks.map((b, i) => {
              if (b.kind === "same") return onlyChanges ? null : <p key={i} className="cmp-same">{b.text}</p>;
              if (b.kind !== "changed") return <p key={i} className={b.kind === "add" ? "cmp-add" : "cmp-del"}>{b.text}</p>;
              return (
                <p key={i}>
                  {b.parts.map((p, j) => (p.type === "same" ? p.value : p.type === "add" ? <ins key={j}>{p.value}</ins> : <del key={j}>{p.value}</del>))}
                </p>
              );
            })
          )}
        </div>
        <footer className="dialog-foot">
          {result && !unchanged && (
            <span className="hint">
              <ins>+{result.added.toLocaleString()}</ins> <del>−{result.removed.toLocaleString()}</del> words since this snapshot
            </span>
          )}
          <label className="check inline-check">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
            <span>Only changes</span>
          </label>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
          <button className="primary" onClick={onRestore}>
            Restore this version…
          </button>
        </footer>
      </div>
    </div>
  );
}
