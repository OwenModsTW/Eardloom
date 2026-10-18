import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { createEntry } from "../lib/actions";
import { EntryGlyph } from "./EntryIcon";
import type { SearchHit } from "../lib/types";

type Item =
  | { kind: "entry"; id: string; title: string; typeId: string; snippet?: string }
  | { kind: "doc"; id: string; title: string; snippet: string }
  | { kind: "create"; typeId: string; title: string };

/** Ctrl+K: jump to anything by name, search full text, or create a new entry. */
export function SearchPalette() {
  const { entries, types, setPalette, go, projects } = useStore();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => api.search(query, 20).then(setHits).catch(() => setHits([])), 120);
    return () => clearTimeout(t);
  }, [query]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const byName = entries
      .filter((e) => !q || [e.title, ...e.aliases].some((n) => n.toLowerCase().includes(q)))
      .slice(0, q ? 8 : 6)
      .map((e): Item => ({ kind: "entry", id: e.id, title: e.title, typeId: e.typeId }));
    const seen = new Set(byName.map((i) => (i.kind === "entry" ? i.id : "")));
    const fullText = hits
      .filter((h) => !seen.has(h.id))
      .map((h): Item =>
        h.kind === "entry"
          ? { kind: "entry", id: h.id, title: h.title, typeId: entries.find((e) => e.id === h.id)?.typeId ?? "", snippet: h.snippet }
          : { kind: "doc", id: h.id, title: h.title, snippet: h.snippet },
      );
    const create = q ? types.map((t): Item => ({ kind: "create", typeId: t.id, title: query.trim() })) : [];
    return [...byName, ...fullText, ...create];
  }, [query, entries, hits, types]);

  useEffect(() => setIndex(0), [query]);

  const choose = async (item: Item | undefined) => {
    if (!item) return;
    setPalette(false);
    if (item.kind === "entry") go({ view: "entry", id: item.id });
    if (item.kind === "create") await createEntry(item.typeId, item.title);
    if (item.kind === "doc") {
      // Docs are indexed by id only; find their project by loading each project's binder.
      for (const p of projects) {
        const docs = await api.listDocs(p.id);
        if (docs.some((d) => d.id === item.id)) return go({ view: "project", id: p.id, docId: item.id });
      }
    }
  };

  return (
    <div className="overlay" onMouseDown={() => setPalette(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search your world, or type a name to create it…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPalette(false);
              if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(i + 1, items.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
              if (e.key === "Enter") choose(items[index]);
            }}
          />
        </div>
        <div className="palette-items">
          {items.map((item, i) => {
            const t = types.find((x) => x.id === (item.kind === "doc" ? "" : item.typeId));
            return (
              <button
                key={`${item.kind}-${item.kind === "create" ? item.typeId : item.id}`}
                className={i === index ? "active" : ""}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(item)}
              >
                {item.kind === "create" ? (
                  <Plus size={14} color={t?.color} />
                ) : item.kind === "doc" ? (
                  <FileText size={14} />
                ) : (
                  <EntryGlyph entry={entries.find((x) => x.id === item.id)} size={14} />
                )}
                <span className="palette-title">
                  {item.kind === "create" ? (
                    <>
                      Create <strong>{item.title}</strong> as a new {t?.name}
                    </>
                  ) : (
                    item.title || "Untitled"
                  )}
                </span>
                {"snippet" in item && item.snippet && <small className="snippet">{item.snippet}</small>}
                {item.kind === "doc" && <small>manuscript</small>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
