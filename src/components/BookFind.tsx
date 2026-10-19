import { useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { Search } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { findMatches, type SearchOptions } from "../lib/editor/search";
import { CHAPTER_EXTENSIONS, withChapter } from "../lib/ai/apply";
import { readingOrder } from "../lib/export/book";
import type { DocSummary } from "../lib/types";

interface Hit {
  docId: string;
  title: string;
  snippets: { before: string; match: string; after: string }[];
  count: number;
}

const CONTEXT = 40;

/** Find (and replace) across every chapter of a book. */
export function BookFind({
  docs,
  flush,
  onOpen,
  onChanged,
}: {
  docs: DocSummary[];
  /** Saves pending edits in the open chapter first. */
  flush: () => Promise<void>;
  onOpen: (docId: string, term: string) => void;
  onChanged: () => void;
}) {
  const notify = useStore((s) => s.notify);
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [opts, setOpts] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false });
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searched, setSearched] = useState("");
  const [busy, setBusy] = useState(false);
  const schema = useMemo(() => getSchema(CHAPTER_EXTENSIONS), []);

  const run = async (q = term) => {
    if (!q.trim()) return setHits(null);
    setBusy(true);
    await flush();
    const out: Hit[] = [];
    for (const d of readingOrder(docs).filter((x) => x.kind === "text")) {
      const doc = await api.getDoc(d.id);
      if (!doc.body) continue;
      let node: PMNode;
      try {
        node = PMNode.fromJSON(schema, doc.body);
      } catch {
        continue;
      }
      const matches = findMatches(node, q, opts);
      if (!matches.length) continue;
      const size = node.content.size;
      out.push({
        docId: d.id,
        title: d.title || "Untitled",
        count: matches.length,
        snippets: matches.slice(0, 20).map((m) => ({
          before: node.textBetween(Math.max(0, m.from - CONTEXT), m.from, " ", " "),
          match: node.textBetween(m.from, m.to, " ", " "),
          after: node.textBetween(m.to, Math.min(size, m.to + CONTEXT), " ", " "),
        })),
      });
    }
    setHits(out);
    setSearched(q);
    setBusy(false);
  };

  const total = hits?.reduce((n, h) => n + h.count, 0) ?? 0;

  const replaceAll = async () => {
    if (!hits?.length) return;
    const where = hits.length === 1 ? "1 chapter" : `${hits.length} chapters`;
    const msg = `Replace ${total} ${total === 1 ? "match" : "matches"} of “${searched}” with “${replacement}” in ${where}? Each chapter gets a snapshot first, so you can undo this.`;
    if (!(await ask(msg, { title: "Replace in book", kind: "warning" }))) return;
    setBusy(true);
    await flush();
    let changed = 0;
    for (const h of hits) {
      await api.createSnapshot(h.docId, `Before replacing “${searched}”`);
      const result = await withChapter(h.docId, (editor) => {
        const ms = findMatches(editor.state.doc, searched, opts);
        if (!ms.length) return null;
        const tr = editor.state.tr;
        // Back to front, so earlier positions stay valid.
        for (const m of [...ms].reverse()) tr.insertText(replacement, m.from, m.to);
        editor.view.dispatch(tr);
        return String(ms.length);
      });
      changed += Number(result) || 0;
    }
    setBusy(false);
    notify(`Replaced ${changed} ${changed === 1 ? "match" : "matches"}`);
    onChanged();
    run(searched);
  };

  return (
    <aside className="lore book-find">
      <h3 className="side-title">Find in book</h3>
      <form className="book-find-form" onSubmit={(e) => (e.preventDefault(), run())}>
        <label className="search-inline">
          <Search size={13} />
          <input autoFocus placeholder="Find" value={term} onChange={(e) => setTerm(e.target.value)} />
        </label>
        <input placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <div className="book-find-opts">
          <label className="check inline-check">
            <input type="checkbox" checked={opts.caseSensitive} onChange={(e) => setOpts({ ...opts, caseSensitive: e.target.checked })} />
            <span>Match case</span>
          </label>
          <label className="check inline-check">
            <input type="checkbox" checked={opts.wholeWord} onChange={(e) => setOpts({ ...opts, wholeWord: e.target.checked })} />
            <span>Whole words</span>
          </label>
        </div>
        <div className="row">
          <button className="primary" type="submit" disabled={busy || !term.trim()}>
            Find
          </button>
          <button type="button" className="ghost" disabled={busy || !hits?.length || searched !== term} onClick={replaceAll}>
            Replace all
          </button>
        </div>
      </form>
      {busy && <p className="hint">Searching…</p>}
      {hits && !busy && (
        <p className="hint">
          {total === 0 ? `No matches for “${searched}”.` : `${total} ${total === 1 ? "match" : "matches"} in ${hits.length} ${hits.length === 1 ? "chapter" : "chapters"}.`}
        </p>
      )}
      <div className="book-find-results">
        {hits?.map((h) => (
          <section key={h.docId}>
            <button className="book-find-chapter" onClick={() => onOpen(h.docId, searched)}>
              <strong>{h.title}</strong>
              <small>{h.count}</small>
            </button>
            {h.snippets.map((s, i) => (
              <button key={i} className="book-find-snippet" onClick={() => onOpen(h.docId, searched)}>
                …{s.before}
                <mark>{s.match}</mark>
                {s.after}…
              </button>
            ))}
            {h.count > h.snippets.length && <p className="hint">and {h.count - h.snippets.length} more</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}
