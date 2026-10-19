import { useContext, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Copy, History, ImagePlus, MoreHorizontal, Network, Pin, Share2, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { confirmDeleteEntry, duplicateEntry } from "../lib/actions";
import { ChipInput, FieldInput } from "./Inputs";
import { MentionClickContext, RichEditor } from "./RichEditor";
import { Select } from "./Select";
import { assetUrl, EntryGlyph } from "./EntryIcon";
import { EmojiPicker } from "./EmojiPicker";
import { ShareCard } from "./ShareCard";
import { LocalGraph } from "./GraphView";
import { openMenu, type MenuItem } from "./ContextMenu";
import { EntryHistory } from "./EntryHistory";
import { FamilyTree } from "./FamilyTree";
import { fieldsById } from "../lib/relations";
import { registerEntryFlush, useEntryRevision } from "../lib/entrySync";
import type { Backlink, Entry, EntryType, FieldDef, FieldValue, Visibility } from "../lib/types";

export { assetUrl };

export function relativeTime(iso: string | undefined) {
  if (!iso) return "";
  // SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC without a zone marker.
  const t = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(t).toLocaleDateString();
}

/** Groups fields under their section headings, keeping first-seen order. */
function sections(fields: FieldDef[]) {
  const out: [string, FieldDef[]][] = [];
  for (const f of fields) {
    const name = f.section?.trim() ?? "";
    const group = out.find(([n]) => n === name);
    group ? group[1].push(f) : out.push([name, [f]]);
  }
  return out;
}

const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Included when shared" },
  { value: "spoiler", label: "Spoiler", hint: "Shared behind a warning" },
  { value: "private", label: "Private", hint: "Never leaves this computer" },
];

/** Entries that already have a version from before this session's first edit. */
const versionedThisSession = new Set<string>();

/** `onOpenEntry` handles clicks on linked entries (otherwise they navigate). */
export function EntryView({ id, onOpenEntry }: { id: string; onOpenEntry?: (id: string) => void }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the entry is changed elsewhere (the assistant, restoring a version).
  const rev = useEntryRevision((s) => s.revs[id] ?? 0);
  const [loadedRev, setLoadedRev] = useState(rev);
  useEffect(() => {
    setEntry(null);
    setError(null);
  }, [id]);
  useEffect(() => {
    let live = true;
    api.getEntry(id).then(
      (e) => live && (setEntry(e), setLoadedRev(rev)),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [id, rev]);

  if (error) return <p className="page-note">This entry couldn't be opened. {error}</p>;
  if (!entry || entry.id !== id) return null;
  return <EntryEditor key={`${entry.id}:${loadedRev}`} initial={entry} onOpenEntry={onOpenEntry} />;
}

function EntryEditor({ initial, onOpenEntry }: { initial: Entry; onOpenEntry?: (id: string) => void }) {
  const [entry, setEntry] = useState(initial);
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [history, setHistory] = useState(false);
  const [family, setFamily] = useState(false);
  const types = useStore((s) => s.types);
  const world = useStore((s) => s.world)!;
  const { go, patchEntry } = useStore.getState();
  const type = types.find((t) => t.id === entry.typeId);
  const inFamilies = type?.fields.some((f) => f.family) ?? false;

  const { schedule, flush } = useAutosave(async (e: Entry) => {
    // Keep the entry as it was before the first edit of the session, so it can be restored.
    if (!versionedThisSession.has(e.id)) {
      versionedThisSession.add(e.id);
      await api.createEntryVersion(e.id, "", true).catch(() => {});
    }
    await api.saveEntry(e);
    patchEntry({
      id: e.id,
      typeId: e.typeId,
      title: e.title,
      aliases: e.aliases,
      summary: e.summary,
      tags: e.tags,
      image: e.image,
      emoji: e.emoji,
      updatedAt: new Date().toISOString(),
    });
  });

  useEffect(() => registerEntryFlush(entry.id, flush), [entry.id, flush]);

  const update = (patch: Partial<Entry>) =>
    setEntry((prev) => {
      const next = { ...prev, ...patch };
      schedule(next);
      return next;
    });
  const setField = (fieldId: string, value: FieldValue) =>
    setEntry((prev) => {
      const next = { ...prev, fields: { ...prev.fields, [fieldId]: value } };
      schedule(next);
      return next;
    });

  const pickImage = async () => {
    const file = await openDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof file === "string") update({ image: await api.importAsset(file) });
  };

  const menu: MenuItem[] = [
    { label: entry.image ? "Replace image…" : "Add image…", icon: <ImagePlus size={14} />, onClick: pickImage },
    ...(entry.image ? [{ label: "Remove image", onClick: () => update({ image: null }) }] : []),
    {
      label: useStore.getState().pinned.includes(entry.id) ? "Unpin from home" : "Pin to home",
      icon: <Pin size={14} />,
      onClick: () => useStore.getState().togglePin(entry.id),
    },
    { label: "History…", icon: <History size={14} />, onClick: () => (flush(), setHistory(true)) },
    ...(inFamilies ? [{ label: "Family tree", icon: <Network size={14} />, onClick: () => (flush(), setFamily(true)) }] : []),
    { label: "Share as image…", icon: <Share2 size={14} />, onClick: () => setSharing(true) },
    { label: "Duplicate", icon: <Copy size={14} />, onClick: () => (flush(), duplicateEntry(entry.id)) },
    "separator",
    {
      label: "Delete entry",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: async () => (await confirmDeleteEntry(entry.id, entry.title)) && go({ view: "type", typeId: entry.typeId }),
    },
  ];

  const image = assetUrl(world.assetsPath, entry.image);

  return (
    <MentionClickContext.Provider value={(id) => (flush(), onOpenEntry ? onOpenEntry(id) : go({ view: "entry", id }))}>
      <article className="entry">
        <div className="entry-main">
          <div className="entry-bar">
            <span className="entry-type" style={{ "--chip": type?.color } as React.CSSProperties}>
              <TypeIcon name={type?.icon ?? ""} size={14} />
              <Select
                className="bare"
                value={entry.typeId}
                title="Change category. Values for fields the new category doesn't have are kept."
                onChange={(typeId) => update({ typeId })}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
              />
            </span>
            <span className="entry-stamp">Edited {relativeTime(entry.updatedAt)}</span>
            <span className="spacer" />
            {inFamilies && (
              <button className="ghost tiny" onClick={() => (flush(), setFamily(true))} title="See this entry's family">
                <Network size={13} /> Family
              </button>
            )}
            <button className="ghost tiny" onClick={() => (flush(), setHistory(true))} title="Earlier versions of this entry">
              <History size={13} /> History
            </button>
            <button className="ghost tiny" onClick={() => setSharing(true)} title="Make a shareable image of this entry">
              Share
            </button>
            <button className="icon-btn" onClick={(e) => openMenu(e, menu)} aria-label="More actions">
              <MoreHorizontal size={16} />
            </button>
          </div>

          <div className="entry-heading">
            <div className="entry-emoji-slot">
              <button
                className={`entry-emoji ${entry.emoji ? "set" : ""}`}
                onClick={() => setPickingEmoji(true)}
                title={entry.emoji ? "Change icon" : "Add an icon (used in lists when there's no image)"}
              >
                {entry.emoji ?? "+"}
              </button>
              {pickingEmoji && (
                <EmojiPicker value={entry.emoji} onPick={(emoji) => update({ emoji })} onClose={() => setPickingEmoji(false)} />
              )}
            </div>
          <input
            className="entry-title"
            value={entry.title}
            placeholder={`Unnamed ${type?.name.toLowerCase() ?? "entry"}`}
            onChange={(e) => update({ title: e.target.value })}
          />
          </div>

          <dl className="props">
            <dt>Also known as</dt>
            <dd>
              <ChipInput values={entry.aliases} onChange={(aliases) => update({ aliases })} placeholder="Other names, titles, nicknames" />
            </dd>
            <dt>Tags</dt>
            <dd>
              <ChipInput values={entry.tags} onChange={(tags) => update({ tags })} placeholder="Add tags" />
            </dd>
          </dl>

          <textarea
            className="lede"
            rows={1}
            placeholder="A single line that sums this up. It shows in link previews."
            value={entry.summary}
            onChange={(e) => update({ summary: e.target.value })}
          />

          <RichEditor
            content={entry.body}
            onChange={(body) => update({ body })}
            className="article"
            placeholder="Write the article. Type @ to link anything else in your world."
          />
          <Backlinks id={entry.id} />
          <LocalGraph id={entry.id} />
        </div>

        <aside className="infobox" style={{ "--chip": type?.color } as React.CSSProperties} onContextMenu={(e) => openMenu(e, menu)}>
          <header className="infobox-head">
            <span>{entry.title || "Unnamed"}</span>
          </header>
          {image ? (
            <img className="infobox-image" src={image} alt="" onClick={pickImage} title="Click to replace" />
          ) : (
            <button className="infobox-add-image" onClick={pickImage}>
              <ImagePlus size={15} /> Add image
            </button>
          )}
          <Infobox type={type} entry={entry} setField={setField} />
          <ReverseLinks entryId={entry.id} />
          <div className="infobox-foot">
            <span>Visibility</span>
            <Select
              className="inline"
              value={entry.visibility}
              onChange={(visibility) => update({ visibility })}
              options={VISIBILITY.map((v) => ({ value: v.value, label: v.label, hint: v.hint }))}
            />
          </div>
        </aside>
      </article>
      {sharing && <ShareCard entry={entry} onClose={() => setSharing(false)} />}
      {history && <EntryHistory entryId={entry.id} flush={flush} onClose={() => setHistory(false)} />}
      {family && <FamilyTree entryId={entry.id} onClose={() => setFamily(false)} />}
    </MentionClickContext.Provider>
  );
}

/**
 * This entry as other entries' link fields see it, named from this side ("Members", "Children"),
 * for fields that have a name for the reverse direction.
 */
function ReverseLinks({ entryId }: { entryId: string }) {
  const { types, entries } = useStore();
  const [links, setLinks] = useState<Backlink[]>([]);
  const rev = useEntryRevision((s) => s.revs[entryId] ?? 0);
  const updated = entries.length;
  useEffect(() => {
    api.backlinks(entryId).then(setLinks);
  }, [entryId, rev, updated]);
  const open = useContext(MentionClickContext);

  const groups = useMemo(() => {
    const fields = fieldsById(types);
    const out = new Map<string, Backlink[]>();
    for (const l of links) {
      const name = l.sourceKind === "entry" ? fields.get(l.via)?.inverse?.trim() : undefined;
      if (!name) continue;
      if (!out.has(name)) out.set(name, []);
      if (!out.get(name)!.some((x) => x.sourceId === l.sourceId)) out.get(name)!.push(l);
    }
    return [...out];
  }, [links, types]);

  if (!groups.length) return null;
  return (
    <section className="infobox-section reverse-links">
      <h4>Connections</h4>
      {groups.map(([name, ls]) => (
        <div key={name} className="infobox-row">
          <span className="infobox-label">{name}</span>
          <div className="infobox-value chips">
            {ls.map((l) => {
              const e = entries.find((x) => x.id === l.sourceId);
              const t = types.find((x) => x.id === e?.typeId);
              return (
                <span key={l.sourceId} className="chip link" style={{ "--chip": t?.color } as React.CSSProperties}>
                  <button className="chip-label" onClick={() => open(l.sourceId)}>
                    {e?.title ?? l.title}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function Infobox({
  type,
  entry,
  setField,
}: {
  type: EntryType | undefined;
  entry: Entry;
  setField: (id: string, v: FieldValue) => void;
}) {
  const go = useStore((s) => s.go);
  const groups = useMemo(() => sections(type?.fields ?? []), [type]);
  if (!type) return null;
  if (!type.fields.length)
    return (
      <p className="infobox-empty">
        No fields yet.{" "}
        <button className="link" onClick={() => go({ view: "schema", typeId: type.id })}>
          Choose what to track for {type.plural.toLowerCase()}
        </button>
      </p>
    );
  return (
    <>
      {groups.map(([section, fields]) => (
        <section key={section} className="infobox-section">
          {section && <h4>{section}</h4>}
          {fields.map((f) => (
            <div key={f.id} className={`infobox-row kind-${f.kind}`} title={f.help}>
              <span className="infobox-label">{f.label}</span>
              <div className="infobox-value">
                <FieldInput field={f} value={entry.fields[f.id]} entryId={entry.id} onChange={(v) => setField(f.id, v)} />
              </div>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function Backlinks({ id }: { id: string }) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const { types, projects, go } = useStore();
  const entries = useStore((s) => s.entries);
  useEffect(() => {
    api.backlinks(id).then(setLinks);
  }, [id, entries]);

  // Open the map centred on this entry's pin.
  const openOnMap = async (mapId: string) => {
    const map = await api.getMap(mapId);
    const pin = map?.data?.pins?.find((p) => p.entryId === id);
    go({ view: "map", id: mapId, pin: pin?.id });
  };

  const fieldLabel = (l: Backlink) => {
    if (l.via === "mention") return "in article";
    for (const t of types) {
      const f = t.fields.find((x) => x.id === l.via);
      if (f) return (f.inverse?.trim() || f.label).toLowerCase();
    }
    return "linked";
  };

  const fromEntries = links.filter((l) => l.sourceKind === "entry");
  const fromDocs = links.filter((l) => l.sourceKind === "doc");
  const onMaps = links.filter((l) => l.sourceKind === "map");
  if (!links.length) return null;

  return (
    <footer className="backlinks">
      {fromEntries.length > 0 && (
        <section>
          <h3>Referenced by</h3>
          <ul>
            {fromEntries.map((l) => {
              const t = types.find((x) => x.id === l.parentId);
              return (
                <li key={l.sourceId + l.via}>
                  <button className="link" style={{ "--chip": t?.color } as React.CSSProperties} onClick={() => go({ view: "entry", id: l.sourceId })}>
                    <EntryGlyph entry={entries.find((x) => x.id === l.sourceId)} size={13} /> {l.title || "Untitled"}
                  </button>
                  <small>{fieldLabel(l)}</small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {onMaps.length > 0 && (
        <section>
          <h3>On maps</h3>
          <ul>
            {onMaps.map((l) => (
              <li key={l.sourceId}>
                <button className="link" onClick={() => openOnMap(l.sourceId)}>
                  {l.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {fromDocs.length > 0 && (
        <section>
          <h3>Appears in your writing</h3>
          <ul>
            {fromDocs.map((l) => (
              <li key={l.sourceId}>
                <button className="link" onClick={() => go({ view: "project", id: l.parentId, docId: l.sourceId })}>
                  {l.title}
                </button>
                <small>{projects.find((p) => p.id === l.parentId)?.title}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </footer>
  );
}
