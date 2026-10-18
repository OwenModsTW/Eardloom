import { useMemo, useState } from "react";
import { Copy, Search, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { confirmDeleteEntry, createEntry, duplicateEntry } from "../lib/actions";
import { assetUrl, relativeTime } from "./EntryView";
import { openMenu } from "./ContextMenu";
import { EntryThumb } from "./EntryIcon";
import type { EntrySummary } from "../lib/types";

type Layout = "table" | "gallery";
type Sort = { key: "title" | "updatedAt"; dir: 1 | -1 };

const layoutKey = (typeId: string) => `eardloom.layout.${typeId}`;
const readLayout = (typeId: string): Layout => {
  try {
    return localStorage.getItem(layoutKey(typeId)) === "gallery" ? "gallery" : "table";
  } catch {
    return "table";
  }
};

export function TypeListView({ typeId }: { typeId: string }) {
  const type = useStore((s) => s.types.find((t) => t.id === typeId));
  const all = useStore((s) => s.entries);
  const world = useStore((s) => s.world)!;
  const go = useStore((s) => s.go);
  const [filter, setFilter] = useState("");
  const [layout, setLayoutState] = useState<Layout>(() => readLayout(typeId));
  const [sort, setSort] = useState<Sort>({ key: "title", dir: 1 });

  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(layoutKey(typeId), l);
    } catch {
      /* per-viewer preference only */
    }
  };

  const ofType = useMemo(() => all.filter((e) => e.typeId === typeId), [all, typeId]);
  const entries = useMemo(() => {
    const q = filter.toLowerCase();
    return ofType
      .filter((e) => !q || [e.title, e.summary, ...e.aliases, ...e.tags].some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => sort.dir * a[sort.key].localeCompare(b[sort.key], undefined, { sensitivity: "base" }));
  }, [ofType, filter, sort]);

  if (!type) return <p className="page-note">This category no longer exists.</p>;

  const rowMenu = (e: React.MouseEvent, entry: EntrySummary) =>
    openMenu(e, [
      { label: "Open", onClick: () => go({ view: "entry", id: entry.id }) },
      {
        label: useStore.getState().pinned.includes(entry.id) ? "Unpin from home" : "Pin to home",
        onClick: () => useStore.getState().togglePin(entry.id),
      },
      { label: "Duplicate", icon: <Copy size={14} />, onClick: () => duplicateEntry(entry.id) },
      "separator",
      { label: "Delete", icon: <Trash2 size={14} />, danger: true, onClick: () => confirmDeleteEntry(entry.id, entry.title) },
    ]);

  const header = (key: Sort["key"], label: string) => (
    <th
      className={`sortable ${sort.key === key ? "sorted" : ""}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "updatedAt" ? -1 : 1 }))}
    >
      {label}
      {sort.key === key && <span className="sort-dir">{sort.dir === 1 ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <div className="page wide">
      <header className="page-head">
        <h1 style={{ "--chip": type.color } as React.CSSProperties}>
          <TypeIcon name={type.icon} size={22} className="type-glyph" />
          {type.plural}
          <span className="count">{ofType.length}</span>
        </h1>
        <div className="toolbar">
          <label className="search-inline">
            <Search size={13} />
            <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="segmented">
            <button className={layout === "table" ? "on" : ""} onClick={() => setLayout("table")}>
              Table
            </button>
            <button className={layout === "gallery" ? "on" : ""} onClick={() => setLayout("gallery")}>
              Gallery
            </button>
          </div>
          <button className="ghost" onClick={() => go({ view: "schema", typeId })}>
            Fields
          </button>
          <button className="primary" onClick={() => createEntry(typeId)}>
            New {type.name.toLowerCase()}
          </button>
        </div>
      </header>

      {ofType.length === 0 ? (
        <div className="blank-slate">
          <p>
            No {type.plural.toLowerCase()} yet. Start with one you already know about. You can fill in the details as you go.
          </p>
          <button className="primary" onClick={() => createEntry(typeId)}>
            New {type.name.toLowerCase()}
          </button>
        </div>
      ) : entries.length === 0 ? (
        <p className="page-note">Nothing matches “{filter}”.</p>
      ) : layout === "table" ? (
        <table className="data-table">
          <thead>
            <tr>
              {header("title", "Name")}
              <th>Summary</th>
              <th>Tags</th>
              {header("updatedAt", "Edited")}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              return (
                <tr key={e.id} onClick={() => go({ view: "entry", id: e.id })} onContextMenu={(ev) => rowMenu(ev, e)}>
                  <td className="cell-name">
                    <EntryThumb entry={e} />
                    <span>{e.title || <em className="placeholder">Unnamed</em>}</span>
                    {e.aliases.length > 0 && <small>{e.aliases.join(", ")}</small>}
                  </td>
                  <td className="cell-summary">{e.summary}</td>
                  <td className="cell-tags">
                    {e.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="cell-date">{relativeTime(e.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="gallery">
          {entries.map((e) => {
            const img = assetUrl(world.assetsPath, e.image);
            return (
              <button
                key={e.id}
                className="tile"
                onClick={() => go({ view: "entry", id: e.id })}
                onContextMenu={(ev) => rowMenu(ev, e)}
                style={{ "--chip": type.color } as React.CSSProperties}
              >
                <div className="tile-image">
                  {img ? <img src={img} alt="" /> : e.emoji ? <span className="tile-emoji">{e.emoji}</span> : <TypeIcon name={type.icon} size={26} />}
                </div>
                <strong>{e.title || "Unnamed"}</strong>
                {e.summary && <p>{e.summary}</p>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
