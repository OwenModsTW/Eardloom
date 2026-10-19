import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, Search, Trash2, X } from "lucide-react";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { bulkDelete, bulkUpdate, confirmDeleteEntry, createEntry, duplicateEntry } from "../lib/actions";
import { deleteTemplate, listTemplates, type EntryTemplate } from "../lib/entryTemplates";
import { askText } from "./Prompt";
import { shareEntry } from "../lib/shareEntry";
import { api } from "../lib/api";
import { assetUrl, relativeTime } from "./EntryView";
import { openMenu } from "./ContextMenu";
import { EntryThumb } from "./EntryIcon";
import type { EntrySummary, Visibility } from "../lib/types";

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
  const [templates, setTemplates] = useState<EntryTemplate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const reloadTemplates = useCallback(() => listTemplates(typeId).then(setTemplates), [typeId]);
  useEffect(() => {
    reloadTemplates();
    setSelected(new Set());
  }, [reloadTemplates, typeId]);

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

  const templateMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: `Blank ${type.name.toLowerCase()}`, onClick: () => createEntry(typeId) },
      ...templates.map((t) => ({ label: `From “${t.name}”`, onClick: () => createEntry(typeId, "", true, t) })),
      "separator",
      ...templates.map((t) => ({
        label: `Remove template “${t.name}”`,
        danger: true,
        onClick: async () => (await deleteTemplate(typeId, t.id), reloadTemplates()),
      })),
      ...(templates.length ? [] : [{ label: "Save any entry as a template from its ⋯ menu", disabled: true, onClick: () => {} }]),
    ]);

  // Selecting rows for bulk changes; Shift selects a range.
  const visibleIds = entries.map((e) => e.id);
  const toggle = (id: string, range: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor && visibleIds.includes(anchor)) {
        const [a, b] = [visibleIds.indexOf(anchor), visibleIds.indexOf(id)].sort((x, y) => x - y);
        for (const x of visibleIds.slice(a, b + 1)) next.add(x);
      } else next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setAnchor(id);
  };
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const ids = [...selected].filter((id) => all.some((e) => e.id === id));
  const done = (n: number, what: string) => useStore.getState().notify(n ? `${what} (${n} ${n === 1 ? "entry" : "entries"})` : "Nothing needed changing");
  const allTags = [...new Set(all.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b));

  const addTag = async () => {
    const tag = await askText({ title: "Add a tag", placeholder: "Tag", suggestions: allTags, confirm: "Add" });
    if (tag) done(await bulkUpdate(ids, (e) => (e.tags.includes(tag) ? null : { ...e, tags: [...e.tags, tag] })), `Tagged “${tag}”`);
  };
  const removeTag = async () => {
    const theirs = [...new Set(all.filter((e) => selected.has(e.id)).flatMap((e) => e.tags))];
    const tag = await askText({ title: "Remove a tag", placeholder: "Tag", suggestions: theirs, confirm: "Remove" });
    if (tag) done(await bulkUpdate(ids, (e) => (e.tags.includes(tag) ? { ...e, tags: e.tags.filter((t) => t !== tag) } : null)), `Removed “${tag}”`);
  };
  const moveTo = (ev: React.MouseEvent) =>
    openMenu(
      ev,
      useStore
        .getState()
        .types.filter((t) => t.id !== typeId)
        .map((t) => ({
          label: t.plural,
          onClick: async () => {
            done(await bulkUpdate(ids, (e) => ({ ...e, typeId: t.id })), `Moved to ${t.plural}`);
            setSelected(new Set());
          },
        })),
    );
  const setVisibility = (ev: React.MouseEvent) =>
    openMenu(
      ev,
      (["public", "spoiler", "private"] as Visibility[]).map((v) => ({
        label: v === "public" ? "Public" : v === "spoiler" ? "Spoiler" : "Private",
        onClick: async () => done(await bulkUpdate(ids, (e) => (e.visibility === v ? null : { ...e, visibility: v })), "Visibility changed"),
      })),
    );

  const rowMenu = (e: React.MouseEvent, entry: EntrySummary) =>
    openMenu(e, [
      { label: "Open", onClick: () => go({ view: "entry", id: entry.id }) },
      {
        label: useStore.getState().pinned.includes(entry.id) ? "Unpin from home" : "Pin to home",
        onClick: () => useStore.getState().togglePin(entry.id),
      },
      { label: "Duplicate", icon: <Copy size={14} />, onClick: () => duplicateEntry(entry.id) },
      "separator",
      { label: "Copy as picture", onClick: async () => shareEntry(await api.getEntry(entry.id), "picture") },
      { label: "Copy as text", onClick: async () => shareEntry(await api.getEntry(entry.id), "text") },
      { label: "Save as PDF…", onClick: async () => shareEntry(await api.getEntry(entry.id), "pdf") },
      { label: "Save as Word document…", onClick: async () => shareEntry(await api.getEntry(entry.id), "docx") },
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
          <div className="split-button">
            <button className="primary" onClick={() => createEntry(typeId)}>
              New {type.name.toLowerCase()}
            </button>
            <button className="primary" onClick={templateMenu} title="Start from a template" aria-label="Start from a template">
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </header>

      {ids.length > 0 && layout === "table" && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected entries">
          <strong>{ids.length} selected</strong>
          <button className="ghost tiny" onClick={addTag}>
            Add tag
          </button>
          <button className="ghost tiny" onClick={removeTag}>
            Remove tag
          </button>
          <button className="ghost tiny" onClick={moveTo}>
            Move to…
          </button>
          <button className="ghost tiny" onClick={setVisibility}>
            Visibility…
          </button>
          <button className="ghost tiny danger" onClick={async () => (await bulkDelete(ids)) && setSelected(new Set())}>
            Delete
          </button>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setSelected(new Set())} title="Clear selection">
            <X size={14} />
          </button>
        </div>
      )}

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
              <th className="cell-check">
                <input
                  type="checkbox"
                  checked={allOn}
                  aria-label="Select all"
                  onChange={() => setSelected(allOn ? new Set() : new Set(visibleIds))}
                />
              </th>
              {header("title", "Name")}
              <th>Summary</th>
              <th>Tags</th>
              {header("updatedAt", "Edited")}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              return (
                <tr
                  key={e.id}
                  className={selected.has(e.id) ? "selected" : ""}
                  onClick={() => go({ view: "entry", id: e.id })}
                  onContextMenu={(ev) => rowMenu(ev, e)}
                >
                  <td className="cell-check" onClick={(ev) => (ev.stopPropagation(), toggle(e.id, ev.shiftKey))}>
                    <input type="checkbox" checked={selected.has(e.id)} readOnly aria-label={`Select ${e.title}`} />
                  </td>
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
