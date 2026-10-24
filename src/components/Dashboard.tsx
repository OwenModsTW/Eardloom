import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Plus } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { createEntry, createProject } from "../lib/actions";
import { formatDate, sortKey } from "../lib/calendar";
import { relativeTime } from "./EntryView";
import { assetUrl, EntryGlyph, EntryThumb } from "./EntryIcon";
import { ShareWorld } from "./ShareWorld";
import { TodayPanel } from "./WritingGoals";
import { openMenu } from "./ContextMenu";
import type { TimelineItem } from "../lib/types";

type Overview = Awaited<ReturnType<typeof api.writingOverview>>;

export function Dashboard() {
  const { world, types, entries, projects, pinned, cover, calendar, go, setWorld, setCover } = useStore();
  const [name, setName] = useState(world!.name);
  const [description, setDescription] = useState(world!.description);
  const [sharing, setSharing] = useState(false);
  const [writing, setWriting] = useState<Overview | null>(null);
  const [incoming, setIncoming] = useState<Record<string, number>>({});
  const [dated, setDated] = useState<TimelineItem[]>([]);
  const { schedule } = useAutosave(async ([n, d]: [string, string]) => setWorld(await api.updateWorldInfo(n, d)));

  useEffect(() => {
    api.writingOverview().then(setWriting);
    api.incomingLinkCounts().then(setIncoming);
    api.timelineItems().then(setDated);
  }, [entries, projects]);

  const pickCover = async () => {
    const file = await openDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof file === "string") setCover(await api.importAsset(file));
  };

  const recent = useMemo(() => [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [entries]);
  const pinnedEntries = pinned.map((id) => entries.find((e) => e.id === id)).filter((e) => !!e);

  // A short worldbuilding to-do list, most useful first.
  const attention = useMemo(() => {
    const out: { id: string; reason: string }[] = [];
    for (const e of recent) {
      if (!e.title.trim()) out.push({ id: e.id, reason: "needs a name" });
      else if (!e.summary.trim()) out.push({ id: e.id, reason: "no summary" });
      else if (!incoming[e.id]) out.push({ id: e.id, reason: "nothing links here" });
    }
    return out;
  }, [recent, incoming]);
  const emptyTypes = types.filter((t) => !entries.some((e) => e.typeId === t.id));

  const latestDated = useMemo(
    () => [...dated].sort((a, b) => sortKey(calendar, b.date) - sortKey(calendar, a.date)).slice(0, 4),
    [dated, calendar],
  );

  const lastDoc = writing?.recent[0];
  const lastProject = projects.find((p) => p.id === lastDoc?.projectId);
  const totals = (id: string) => writing?.totals.find((t) => t.projectId === id);
  const coverUrl = world && cover ? assetUrl(world.assetsPath, cover) : null;

  return (
    <div className="dash">
      <section
        className={`dash-cover ${coverUrl ? "has-image" : ""}`}
        style={coverUrl ? ({ "--cover": `url("${coverUrl}")` } as React.CSSProperties) : undefined}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: coverUrl ? "Change cover image…" : "Add cover image…", onClick: pickCover },
            ...(coverUrl ? [{ label: "Remove cover image", onClick: () => setCover(null) }] : []),
          ])
        }
      >
        <div className="dash-cover-actions">
          <button className="cover-btn" onClick={pickCover}>
            <ImagePlus size={14} /> {coverUrl ? "Change cover" : "Add cover"}
          </button>
          <button className="cover-btn" onClick={() => setSharing(true)}>
            Share world…
          </button>
        </div>
        <div className="dash-cover-text">
          <input
            className="world-title"
            value={name}
            onChange={(e) => (setName(e.target.value), schedule([e.target.value, description]))}
          />
          <textarea
            className="world-premise"
            rows={1}
            placeholder="The premise, in a sentence or two."
            value={description}
            onChange={(e) => (setDescription(e.target.value), schedule([name, e.target.value]))}
          />
          <p className="dash-stats">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} · {types.length} categories
            {writing && writing.totals.length > 0 && ` · ${writing.totals.reduce((n, t) => n + t.words, 0).toLocaleString()} words written`}
          </p>
        </div>
      </section>
      {sharing && <ShareWorld onClose={() => setSharing(false)} />}

      <div className="dash-body">
        <div className="dash-main">
          {lastDoc && lastProject ? (
            <section className="resume">
              <div>
                <span className="eyebrow">Continue writing</span>
                <h2>{lastDoc.title || "Untitled"}</h2>
                <p className="resume-meta">
                  {lastProject.title} · {lastDoc.wordCount.toLocaleString()} words · edited {relativeTime(lastDoc.updatedAt)}
                </p>
              </div>
              <button className="primary" onClick={() => go({ view: "project", id: lastProject.id, docId: lastDoc.id })}>
                Resume
              </button>
            </section>
          ) : (
            <section className="resume empty">
              <div>
                <span className="eyebrow">Writing</span>
                <h2>Start a story in this world</h2>
                <p className="resume-meta">Books live beside your lore. Type @ in a chapter to link or create entries as you go.</p>
              </div>
              <button className="primary" onClick={() => createProject("Untitled Book")}>
                New book
              </button>
            </section>
          )}

          {projects.length > 1 && (
            <div className="books">
              {projects.map((p) => (
                <button key={p.id} className="book" onClick={() => go({ view: "project", id: p.id })}>
                  <strong>{p.title}</strong>
                  <small>
                    {(totals(p.id)?.words ?? 0).toLocaleString()} words · {totals(p.id)?.documents ?? 0} documents
                  </small>
                </button>
              ))}
            </div>
          )}

          <h3 className="dash-heading">Codex</h3>
          <div className="codex-tiles">
            {types.map((t) => {
              const list = recent.filter((e) => e.typeId === t.id);
              return (
                <div key={t.id} className="codex-tile" style={{ "--chip": t.color } as React.CSSProperties}>
                  <button className="codex-tile-head" onClick={() => go({ view: "type", typeId: t.id })}>
                    <TypeIcon name={t.icon} size={16} className="type-glyph" />
                    <span>{t.plural}</span>
                    <small>{list.length || ""}</small>
                  </button>
                  {list.length > 0 ? (
                    <div className="codex-tile-thumbs">
                      {list.slice(0, 6).map((e) => (
                        <button key={e.id} title={e.title} onClick={() => go({ view: "entry", id: e.id })}>
                          <EntryThumb entry={e} size={30} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="codex-tile-empty">Nothing here yet</p>
                  )}
                  <button className="codex-tile-new" onClick={() => createEntry(t.id)}>
                    <Plus size={12} /> New {t.name.toLowerCase()}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="dash-side">
          {writing && projects.length > 0 && <TodayPanel overview={writing} projects={projects} />}

          <section className="panel">
            <h2>Pinned</h2>
            {pinnedEntries.length ? (
              <ul className="recent">
                {pinnedEntries.map((e) => (
                  <li key={e!.id}>
                    <button className="link" onClick={() => go({ view: "entry", id: e!.id })}>
                      <EntryGlyph entry={e} size={13} /> {e!.title || "Unnamed"}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-note">Keep key pages one click away: choose Pin to home from an entry's ⋯ menu.</p>
            )}
          </section>

          {latestDated.length > 0 && (
            <section className="panel">
              <h2>
                Timeline
                <button className="link quiet" onClick={() => go({ view: "timeline" })}>
                  open
                </button>
              </h2>
              <ul className="recent dated">
                {latestDated.map((it) => (
                  <li key={it.entryId + it.fieldId}>
                    <button className="link" onClick={() => go({ view: "entry", id: it.entryId })}>
                      <EntryGlyph entry={{ typeId: it.typeId, emoji: it.emoji, image: null }} size={13} /> {it.title}
                    </button>
                    <small>{formatDate(calendar, it.date)}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(attention.length > 0 || emptyTypes.length > 0) && (
            <section className="panel">
              <h2>Needs attention</h2>
              <ul className="recent">
                {attention.slice(0, 6).map((a) => {
                  const e = entries.find((x) => x.id === a.id)!;
                  return (
                    <li key={a.id}>
                      <button className="link" onClick={() => go({ view: "entry", id: a.id })}>
                        <EntryGlyph entry={e} size={13} /> {e.title || "Unnamed"}
                      </button>
                      <small>{a.reason}</small>
                    </li>
                  );
                })}
              </ul>
              {attention.length > 6 && <p className="panel-note">and {attention.length - 6} more</p>}
              {emptyTypes.length > 0 && <p className="panel-note">Empty: {emptyTypes.map((t) => t.plural).join(", ")}</p>}
            </section>
          )}

          <section className="panel">
            <h2>Recently edited</h2>
            {recent.length === 0 ? (
              <p className="panel-note">Nothing yet. Pick a category, or press Ctrl K and type a name.</p>
            ) : (
              <ul className="recent">
                {recent.slice(0, 8).map((e) => (
                  <li key={e.id}>
                    <button className="link" onClick={() => go({ view: "entry", id: e.id })}>
                      <EntryGlyph entry={e} size={13} /> {e.title || "Unnamed"}
                    </button>
                    <small>{relativeTime(e.updatedAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
