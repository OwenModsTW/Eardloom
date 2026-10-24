import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { formatDate } from "../lib/calendar";
import { LABEL_COLORS, planOf } from "../lib/plan";
import { readingOrder } from "../lib/export/book";
import { continuityChecks, presentIn, QUIET_AFTER, type Check, type Scene } from "../lib/scenes";
import { EntryPicker } from "./Inputs";
import { DateInput } from "./DateInput";
import { EntryGlyph } from "./EntryIcon";
import { askText } from "./Prompt";
import type { DocSummary, Entry, Project, SceneMeta } from "../lib/types";

/** Saves a chapter's scene details and updates the binder without a reload. */
export function useSceneMeta(patchDoc: (id: string, patch: Partial<DocSummary>) => void) {
  return (doc: DocSummary, patch: Partial<SceneMeta>) => {
    const meta = { ...doc.meta, ...patch };
    for (const k of Object.keys(meta) as (keyof SceneMeta)[]) if (meta[k] === undefined || (Array.isArray(meta[k]) && !(meta[k] as unknown[]).length)) delete meta[k];
    patchDoc(doc.id, { meta });
    api.updateDocMeta(doc.id, meta).catch((e) => useStore.getState().notify(String(e)));
  };
}

/** Adds a plot thread to a book. Resolves to its id. */
export async function addThread(project: Project): Promise<string | null> {
  const name = await askText({ title: "New plot thread", placeholder: "e.g. The missing ship", confirm: "Add thread" });
  if (!name) return null;
  const threads = planOf(project).threads;
  const thread = { id: crypto.randomUUID(), name, color: LABEL_COLORS[threads.length % LABEL_COLORS.length] };
  await api.saveProject({ ...project, settings: { ...project.settings, threads: [...threads, thread] } });
  await useStore.getState().refreshProjects();
  return thread.id;
}

/** "POV Vex · Highmoor Harbour · 3 Frostmoon 431 AT", and thread colours, for cards and the outline. */
export function SceneLine({ project, doc }: { project: Project; doc: DocSummary }) {
  const { entries, calendar } = useStore();
  const { threads } = planOf(project);
  const m = doc.meta ?? {};
  const name = (id?: string) => entries.find((e) => e.id === id)?.title;
  const parts = [m.pov && `POV ${name(m.pov) ?? "?"}`, name(m.location), m.date && formatDate(calendar, m.date)].filter(Boolean);
  const own = threads.filter((t) => m.threads?.includes(t.id));
  if (!parts.length && !own.length) return null;
  return (
    <span className="scene-line">
      {own.map((t) => (
        <i key={t.id} style={{ background: t.color }} title={t.name} />
      ))}
      {parts.join(" · ")}
    </span>
  );
}

/** A chapter's scene details: who, where, when, and the plot threads it carries. */
export function ScenePanel({
  project,
  doc,
  patchDoc,
}: {
  project: Project;
  doc: DocSummary;
  patchDoc: (id: string, patch: Partial<DocSummary>) => void;
}) {
  const entries = useStore((s) => s.entries);
  const save = useSceneMeta(patchDoc);
  const { threads } = planOf(project);
  const [mentions, setMentions] = useState<string[]>([]);
  const m = doc.meta ?? {};

  // Who the text mentions changes as it's written (it's indexed when the chapter saves).
  useEffect(() => {
    api.sceneIndex().then((all) => setMentions(all.find((s) => s.id === doc.id)?.mentions ?? []));
  }, [doc.id, doc.wordCount]);

  const people = presentIn({ meta: m, mentions });
  const how = (id: string) => (id === m.pov ? "point of view" : m.present?.includes(id) ? "added" : "mentioned");
  const remove = (id: string) =>
    m.present?.includes(id)
      ? save(doc, { present: m.present.filter((x) => x !== id) })
      : save(doc, { absent: [...(m.absent ?? []), id] });

  return (
    <aside className="lore scene-panel">
      <h3 className="side-title">Scene</h3>
      <p className="hint">What happens in “{doc.title || "this chapter"}”, in terms of your world.</p>
      <label className="scene-field">
        <span>Point of view</span>
        <EntryPicker value={m.pov ? [m.pov] : []} multiple={false} onChange={([id]) => save(doc, { pov: id })} />
      </label>
      <label className="scene-field">
        <span>Where</span>
        <EntryPicker value={m.location ? [m.location] : []} multiple={false} onChange={([id]) => save(doc, { location: id })} />
      </label>
      <div className="scene-field">
        <span>When</span>
        <DateInput value={m.date ?? null} onChange={(date) => save(doc, { date: date ?? undefined })} />
      </div>
      <div className="scene-field">
        <span>Plot threads</span>
        <div className="scene-threads">
          {threads.map((t) => {
            const on = m.threads?.includes(t.id) ?? false;
            return (
              <button
                key={t.id}
                className={`thread-chip ${on ? "on" : ""}`}
                style={{ "--thread": t.color } as React.CSSProperties}
                onClick={() => save(doc, { threads: on ? m.threads!.filter((x) => x !== t.id) : [...(m.threads ?? []), t.id] })}
              >
                {t.name}
              </button>
            );
          })}
          <button
            className="link quiet"
            onClick={async () => {
              const id = await addThread(project);
              if (id) save(doc, { threads: [...(m.threads ?? []), id] });
            }}
          >
            <Plus size={12} /> New thread
          </button>
        </div>
      </div>
      <div className="scene-field">
        <span>In this scene</span>
        <ul className="scene-people">
          {people.map((id) => {
            const e = entries.find((x) => x.id === id);
            return (
              <li key={id}>
                <EntryGlyph entry={e} size={13} />
                <span className="scene-person">{e?.title ?? "Missing entry"}</span>
                <small>{how(id)}</small>
                {id !== m.pov && (
                  <button className="icon-btn" onClick={() => remove(id)} title={how(id) === "mentioned" ? "Only mentioned, not actually here" : "Remove"}>
                    <X size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!people.length && <p className="hint">Anyone you @mention in the chapter shows up here.</p>}
        <EntryPicker
          value={[]}
          multiple={false}
          onChange={([id]) => id && save(doc, { present: [...(m.present ?? []), id], absent: (m.absent ?? []).filter((x) => x !== id) })}
        />
        {(m.absent?.length ?? 0) > 0 && (
          <p className="hint">
            Only mentioned:{" "}
            {m.absent!.map((id, i) => (
              <span key={id}>
                {i > 0 && ", "}
                <button className="link" onClick={() => save(doc, { absent: m.absent!.filter((x) => x !== id) })} title="Count them as here after all">
                  {entries.find((e) => e.id === id)?.title ?? "?"}
                </button>
              </span>
            ))}
          </p>
        )}
      </div>
    </aside>
  );
}

/** The book's chapters as scenes, in reading order. */
async function bookScenes(projectId: string, docs: DocSummary[]): Promise<Scene[]> {
  const all = new Map((await api.sceneIndex()).filter((s) => s.projectId === projectId).map((s) => [s.id, s]));
  return readingOrder(docs)
    .filter((d) => d.kind === "text")
    .map((d) => all.get(d.id))
    .filter((s): s is Scene => !!s);
}

/** Continuity problems in a book, each a click away from its chapter. */
export function ContinuityPanel({ project, docs, onOpen }: { project: Project; docs: DocSummary[]; onOpen: (docId: string) => void }) {
  const { entries, types, calendar } = useStore();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const { threads } = planOf(project);

  useEffect(() => {
    let live = true;
    (async () => {
      const scenes = await bookScenes(project.id, docs);
      const people = new Set(scenes.flatMap((s) => presentIn(s)));
      const full = new Map<string, Entry>();
      for (const id of people) await api.getEntry(id).then((e) => full.set(id, e), () => {});
      const title = (id: string) => entries.find((e) => e.id === id)?.title ?? "Someone";
      if (live) setChecks(continuityChecks(scenes, { calendar, entries: full, types, threads, title }));
    })();
    return () => {
      live = false;
    };
  }, [project.id, docs, entries, types, calendar]);

  return (
    <aside className="lore continuity">
      <h3 className="side-title">Continuity</h3>
      {!checks ? (
        <p className="hint">Checking…</p>
      ) : checks.length === 0 ? (
        <p className="continuity-ok">
          <CheckCircle2 size={15} /> Nothing to flag.
        </p>
      ) : (
        <ul className="continuity-list">
          {checks.map((c, i) => (
            <li key={i}>
              <button onClick={() => c.docId && onOpen(c.docId)}>
                <AlertTriangle size={13} />
                <span>{c.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Uses each chapter's scene details (Scene panel): someone in two places on the same day, appearing before they're born
        or after they've died (from date fields named Born and Died), and points of view or plot threads that go quiet for{" "}
        {QUIET_AFTER} chapters or more.
      </p>
    </aside>
  );
}

/** Plot threads across the book: which chapters carry each one, and where one goes quiet. */
export function ThreadsView({
  project,
  docs,
  patchDoc,
  openDoc,
}: {
  project: Project;
  docs: DocSummary[];
  patchDoc: (id: string, patch: Partial<DocSummary>) => void;
  openDoc: (id: string) => void;
}) {
  const { entries } = useStore();
  const save = useSceneMeta(patchDoc);
  const { threads } = planOf(project);
  const chapters = useMemo(() => readingOrder(docs).filter((d) => d.kind === "text"), [docs]);
  const povs = [...new Set(chapters.map((c) => c.meta?.pov).filter((x): x is string => !!x))];

  return (
    <div className="threads-view">
      <p className="hint">
        Each row is a plot thread; each column a chapter, in reading order. Click a square to say a chapter moves that thread on.
        A long run of empty squares is a thread gone quiet.
      </p>
      {threads.length === 0 ? (
        <div className="blank-slate">
          <p>No plot threads yet. Add the storylines you want to follow through the book.</p>
          <button className="primary" onClick={() => addThread(project)}>
            <Plus size={14} /> New thread
          </button>
        </div>
      ) : (
        <div className="threads-grid" style={{ gridTemplateColumns: `200px repeat(${chapters.length}, 30px)` }}>
          <span />
          {chapters.map((c, i) => (
            <button key={c.id} className="threads-col" title={c.title || "Untitled"} onClick={() => openDoc(c.id)}>
              {i + 1}
            </button>
          ))}
          {threads.map((t) => (
            <ThreadRow key={t.id} name={t.name} color={t.color}>
              {chapters.map((c) => {
                const on = c.meta?.threads?.includes(t.id) ?? false;
                return (
                  <button
                    key={c.id}
                    className={`thread-cell ${on ? "on" : ""}`}
                    style={{ "--thread": t.color } as React.CSSProperties}
                    title={`${c.title || "Untitled"}: ${on ? "moves" : "doesn't move"} “${t.name}” on`}
                    onClick={() => save(c, { threads: on ? c.meta.threads!.filter((x) => x !== t.id) : [...(c.meta?.threads ?? []), t.id] })}
                  />
                );
              })}
            </ThreadRow>
          ))}
          {povs.length > 0 && (
            <ThreadRow name="Point of view" color="var(--muted)">
              {chapters.map((c) => {
                const pov = entries.find((e) => e.id === c.meta?.pov);
                return (
                  <span key={c.id} className="pov-cell" title={pov ? `${c.title}: ${pov.title}` : c.title}>
                    {pov ? <EntryGlyph entry={pov} size={13} /> : null}
                  </span>
                );
              })}
            </ThreadRow>
          )}
        </div>
      )}
      {threads.length > 0 && (
        <button className="ghost threads-add" onClick={() => addThread(project)}>
          <Plus size={14} /> New thread
        </button>
      )}
    </div>
  );
}

function ThreadRow({ name, color, children }: { name: string; color: string; children: React.ReactNode }) {
  return (
    <>
      <span className="thread-name">
        <i style={{ background: color }} />
        {name}
      </span>
      {children}
    </>
  );
}
