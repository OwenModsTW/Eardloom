import { useCallback, useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Bookmark, X } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { toParagraphs } from "../lib/text";
import { compareParagraphs } from "../lib/diff";
import { entryChanged } from "../lib/entrySync";
import { relativeTime } from "./EntryView";
import { openMenu } from "./ContextMenu";
import type { Entry, EntryVersionData } from "../lib/types";

type Version = Awaited<ReturnType<typeof api.listEntryVersions>>[number];

const stamp = (iso: string) => {
  const d = new Date(`${iso.replace(" ", "T")}Z`);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What differs between a saved version and the entry now, besides the article. */
function otherChanges(old: EntryVersionData, now: Entry, fieldLabel: (id: string) => string): string[] {
  const out: string[] = [];
  if (old.title !== now.title) out.push(`Title (was “${old.title}”)`);
  if (!same(old.aliases, now.aliases)) out.push("Also known as");
  if (!same(old.tags, now.tags)) out.push("Tags");
  if (old.image !== now.image) out.push("Image");
  if (old.emoji !== now.emoji) out.push("Icon");
  const keys = new Set([...Object.keys(old.fields ?? {}), ...Object.keys(now.fields ?? {})]);
  for (const k of keys) if (!same(old.fields?.[k], now.fields?.[k])) out.push(fieldLabel(k));
  return out;
}

/** Saved versions of an entry: compare any with the entry now, and restore. */
export function EntryHistory({ entryId, flush, onClose }: { entryId: string; flush: () => Promise<void>; onClose: () => void }) {
  const { types, notify, patchEntry } = useStore();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [selected, setSelected] = useState<Version | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  const reload = useCallback(
    () =>
      api.listEntryVersions(entryId).then((list) => {
        setVersions(list);
        setSelected((s) => list.find((v) => v.id === s?.id) ?? list[0] ?? null);
      }),
    [entryId],
  );
  useEffect(() => {
    reload();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reload, onClose]);

  const save = async () => {
    await flush();
    await api.createEntryVersion(entryId, name.trim() || "Saved version");
    setName("");
    await reload();
    notify("Version saved");
  };

  const restore = async (v: Version) => {
    const label = v.name ? `“${v.name}”` : `the ${stamp(v.createdAt)} version`;
    if (!(await ask(`Put this entry back to ${label}? It's saved as it is now first, so you can undo this.`, { title: "Restore version", kind: "warning" })))
      return;
    await flush();
    await api.createEntryVersion(entryId, `Before restoring ${v.name || stamp(v.createdAt)}`);
    const [now, data] = await Promise.all([api.getEntry(entryId), api.getEntryVersion(v.id)]);
    const next: Entry = { ...now, ...data };
    await api.saveEntry(next);
    patchEntry({ ...next, updatedAt: new Date().toISOString() });
    entryChanged(entryId);
    notify("Restored");
    onClose();
  };

  const menu = (e: React.MouseEvent, v: Version) =>
    openMenu(e, [
      { label: "Restore this version…", onClick: () => restore(v) },
      { label: v.automatic ? "Keep and name…" : "Rename…", onClick: () => setRenaming(v.id) },
      "separator",
      { label: "Delete", danger: true, onClick: async () => (await api.deleteEntryVersion(v.id), reload()) },
    ]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog entry-history" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Entry history">
        <header className="dialog-head row">
          <h2>History</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="history-body">
          <aside className="history-list">
            <form className="snap-take" onSubmit={(e) => (e.preventDefault(), save())}>
              <input value={name} placeholder="Name (optional)" onChange={(e) => setName(e.target.value)} />
              <button className="primary" type="submit" title="Save this entry as it is now">
                <Bookmark size={14} /> Save
              </button>
            </form>
            <p className="hint">Eardloom also keeps a version before your first edit each session and before every assistant change.</p>
            <ul className="snap-list">
              {versions?.map((v) => (
                <li key={v.id} className={selected?.id === v.id ? "on" : ""} onContextMenu={(e) => menu(e, v)}>
                  {renaming === v.id ? (
                    <input
                      autoFocus
                      defaultValue={v.name}
                      onBlur={async (e) => (await api.renameEntryVersion(v.id, e.target.value.trim()), setRenaming(null), reload())}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
                    />
                  ) : (
                    <button className="snap-main" onClick={() => setSelected(v)}>
                      <strong className={v.automatic && !v.name ? "auto" : ""}>{v.name || "Automatic"}</strong>
                      <small>
                        {stamp(v.createdAt)} · {v.wordCount.toLocaleString()} words · {relativeTime(v.createdAt)}
                      </small>
                    </button>
                  )}
                  <button className="link quiet" onClick={(e) => menu(e, v)} aria-label="Version actions">
                    ⋯
                  </button>
                </li>
              ))}
            </ul>
            {versions?.length === 0 && <p className="hint">No versions yet. One is kept automatically the next time this entry changes.</p>}
          </aside>
          <section className="history-compare">
            {selected ? (
              <Comparison
                key={selected.id}
                entryId={entryId}
                version={selected}
                flush={flush}
                fieldLabel={(id) => {
                  for (const t of types) {
                    const f = t.fields.find((x) => x.id === id);
                    if (f) return f.label;
                  }
                  return "A field";
                }}
                onRestore={() => restore(selected)}
              />
            ) : (
              <p className="hint">Choose a version to compare it with the entry now.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Comparison({
  entryId,
  version,
  flush,
  fieldLabel,
  onRestore,
}: {
  entryId: string;
  version: Version;
  flush: () => Promise<void>;
  fieldLabel: (id: string) => string;
  onRestore: () => void;
}) {
  const [state, setState] = useState<{
    article: ReturnType<typeof compareParagraphs>;
    summary: ReturnType<typeof compareParagraphs> | null;
    others: string[];
  } | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);

  useEffect(() => {
    (async () => {
      await flush();
      const [old, now] = await Promise.all([api.getEntryVersion(version.id), api.getEntry(entryId)]);
      setState({
        article: compareParagraphs(toParagraphs(old.body), toParagraphs(now.body)),
        summary: old.summary !== now.summary ? compareParagraphs([old.summary], [now.summary]) : null,
        others: otherChanges(old, now, fieldLabel),
      });
    })();
  }, [version.id, entryId]);

  if (!state) return <p className="hint">Comparing…</p>;
  const articleChanged = state.article.added > 0 || state.article.removed > 0;
  const nothing = !articleChanged && !state.summary && state.others.length === 0;

  const blocks = (r: ReturnType<typeof compareParagraphs>) =>
    r.blocks.map((b, i) => {
      if (b.kind === "same") return onlyChanges ? null : <p key={i} className="cmp-same">{b.text}</p>;
      if (b.kind !== "changed") return <p key={i} className={b.kind === "add" ? "cmp-add" : "cmp-del"}>{b.text}</p>;
      return (
        <p key={i}>
          {b.parts.map((p, j) => (p.type === "same" ? p.value : p.type === "add" ? <ins key={j}>{p.value}</ins> : <del key={j}>{p.value}</del>))}
        </p>
      );
    });

  return (
    <>
      <div className="history-head">
        <strong>{version.name || "Automatic version"}</strong>
        <span className="hint">{stamp(version.createdAt)}, compared with now</span>
      </div>
      <div className="compare-body">
        {nothing ? (
          <p className="hint">No differences. The entry is the same as this version.</p>
        ) : (
          <>
            {state.others.length > 0 && (
              <p className="history-others">
                <span className="hint">Also changed: </span>
                {state.others.join(", ")}
              </p>
            )}
            {state.summary && (
              <>
                <h4 className="history-part">Summary</h4>
                {blocks(state.summary)}
              </>
            )}
            {articleChanged && (
              <>
                <h4 className="history-part">Article</h4>
                {blocks(state.article)}
              </>
            )}
          </>
        )}
      </div>
      <footer className="dialog-foot">
        {articleChanged && (
          <span className="hint">
            <ins>+{state.article.added.toLocaleString()}</ins> <del>−{state.article.removed.toLocaleString()}</del> words since
          </span>
        )}
        <label className="check inline-check">
          <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
          <span>Only changes</span>
        </label>
        <span className="spacer" />
        <button className="primary" onClick={onRestore} disabled={nothing}>
          Restore this version…
        </button>
      </footer>
    </>
  );
}
