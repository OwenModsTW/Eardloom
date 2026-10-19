import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Map as MapIcon, ScrollText, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { EntryView } from "./EntryView";
import { EntryGlyph } from "./EntryIcon";
import { MapEditor } from "./maps/MapEditor";
import type { DocSummary } from "../lib/types";

export type SplitTarget = { kind: "entry" | "doc" | "map"; id: string };
type Kind = SplitTarget["kind"];

const KINDS: { kind: Kind; label: string; icon: ReactNode }[] = [
  { kind: "entry", label: "Entry", icon: <ScrollText size={13} /> },
  { kind: "doc", label: "Chapter", icon: <FileText size={13} /> },
  { kind: "map", label: "Map", icon: <MapIcon size={13} /> },
];

/** The second pane beside the manuscript: an entry, another chapter of this book, or a map. */
export function SplitPane({
  target,
  docs,
  activeDocId,
  renderDoc,
  onChange,
  onClose,
}: {
  target: SplitTarget | null;
  docs: DocSummary[];
  activeDocId: string | undefined;
  renderDoc: (id: string) => ReactNode;
  onChange: (t: SplitTarget | null) => void;
  onClose: () => void;
}) {
  const entries = useStore((s) => s.entries);
  const [choosing, setChoosing] = useState(!target);
  useEffect(() => setChoosing(!target), [target?.kind, target?.id]);

  const title =
    target?.kind === "entry"
      ? entries.find((e) => e.id === target.id)?.title
      : target?.kind === "doc"
        ? docs.find((d) => d.id === target.id)?.title
        : undefined;

  let body: ReactNode;
  if (choosing || !target) {
    body = <Chooser initial={target?.kind ?? "entry"} docs={docs} activeDocId={activeDocId} onPick={(t) => (onChange(t), setChoosing(false))} />;
  } else if (target.kind === "entry") {
    body = (
      <div className="split-scroll">
        <EntryView id={target.id} onOpenEntry={(id) => onChange({ kind: "entry", id })} />
      </div>
    );
  } else if (target.kind === "doc") {
    body =
      target.id === activeDocId ? (
        <p className="hint split-note">This chapter is already open on the left. Pick another one to see them side by side.</p>
      ) : (
        <div className="split-scroll">{renderDoc(target.id)}</div>
      );
  } else {
    body = <MapEditor key={target.id} id={target.id} />;
  }

  return (
    <section className="split-pane" aria-label="Side by side">
      <header className="split-head">
        {target && !choosing ? (
          <>
            {KINDS.find((k) => k.kind === target.kind)?.icon}
            <strong>{title ?? (target.kind === "map" ? "Map" : "")}</strong>
            <button className="link quiet" onClick={() => setChoosing(true)}>
              Change
            </button>
          </>
        ) : (
          <strong>Open beside your chapter</strong>
        )}
        <span className="spacer" />
        {choosing && target && (
          <button className="link quiet" onClick={() => setChoosing(false)}>
            Cancel
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Close side pane">
          <X size={15} />
        </button>
      </header>
      <div className="split-body">{body}</div>
    </section>
  );
}

function Chooser({
  initial,
  docs,
  activeDocId,
  onPick,
}: {
  initial: Kind;
  docs: DocSummary[];
  activeDocId: string | undefined;
  onPick: (t: SplitTarget) => void;
}) {
  const entries = useStore((s) => s.entries);
  const [kind, setKind] = useState<Kind>(initial);
  const [query, setQuery] = useState("");
  const [maps, setMaps] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    api.listMaps().then((m) => setMaps(m.map(({ id, title }) => ({ id, title }))));
  }, []);

  const q = query.trim().toLowerCase();
  const options = useMemo(() => {
    if (kind === "entry")
      return entries
        .filter((e) => !q || [e.title, ...e.aliases, ...e.tags].some((s) => s.toLowerCase().includes(q)))
        .slice(0, 80)
        .map((e) => ({ id: e.id, label: e.title, icon: <EntryGlyph entry={e} size={13} /> }));
    if (kind === "doc")
      return docs
        .filter((d) => d.kind === "text" && d.id !== activeDocId && (!q || d.title.toLowerCase().includes(q)))
        .sort((a, b) => a.sort - b.sort)
        .map((d) => ({ id: d.id, label: d.title || "Untitled", icon: <FileText size={13} /> }));
    return maps.filter((m) => !q || m.title.toLowerCase().includes(q)).map((m) => ({ id: m.id, label: m.title, icon: <MapIcon size={13} /> }));
  }, [kind, q, entries, docs, maps, activeDocId]);

  const empty = kind === "entry" ? "No entries match." : kind === "doc" ? "No other chapters in this book yet." : "No maps yet.";

  return (
    <div className="split-chooser">
      <div className="segmented">
        {KINDS.map((k) => (
          <button key={k.kind} className={kind === k.kind ? "on" : ""} onClick={() => setKind(k.kind)}>
            {k.icon} {k.label}
          </button>
        ))}
      </div>
      <label className="search-inline">
        <Search size={13} />
        <input autoFocus placeholder="Find…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <ul className="split-options">
        {options.map((o) => (
          <li key={o.id}>
            <button onClick={() => onPick({ kind, id: o.id })}>
              {o.icon} <span>{o.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {options.length === 0 && <p className="hint">{empty}</p>}
    </div>
  );
}
