import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { createEntry, createProject } from "../lib/actions";
import { EntryGlyph } from "./EntryIcon";
import { relativeTime } from "./EntryView";
import { ShareWorld } from "./ShareWorld";

export function Dashboard() {
  const { world, types, entries, projects, go, setWorld } = useStore();
  const [name, setName] = useState(world!.name);
  const [description, setDescription] = useState(world!.description);
  const [sharing, setSharing] = useState(false);
  const { schedule } = useAutosave(async ([n, d]: [string, string]) => setWorld(await api.updateWorldInfo(n, d)));

  const recent = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  const unnamed = entries.filter((e) => !e.title.trim()).length;
  const bare = entries.filter((e) => !e.summary.trim()).length;

  return (
    <div className="page dashboard">
      <div className="dash-actions">
        <button className="ghost" onClick={() => setSharing(true)}>
          Share world…
        </button>
      </div>
      {sharing && <ShareWorld onClose={() => setSharing(false)} />}
      <input
        className="world-title"
        value={name}
        onChange={(e) => (setName(e.target.value), schedule([e.target.value, description]))}
      />
      <textarea
        className="world-premise"
        rows={2}
        placeholder="The premise, in a sentence or two. What would you tell someone at the door?"
        value={description}
        onChange={(e) => (setDescription(e.target.value), schedule([name, e.target.value]))}
      />

      <div className="dash-grid">
        <section className="panel">
          <h2>Codex</h2>
          <table className="tally">
            <tbody>
              {types.map((t) => {
                const n = entries.filter((e) => e.typeId === t.id).length;
                return (
                  <tr key={t.id} onClick={() => go({ view: "type", typeId: t.id })}>
                    <td style={{ "--chip": t.color } as React.CSSProperties}>
                      <TypeIcon name={t.icon} size={14} className="type-glyph" /> {t.plural}
                    </td>
                    <td className="num">{n || "–"}</td>
                    <td className="act">
                      <button
                        className="link quiet"
                        onClick={(e) => (e.stopPropagation(), createEntry(t.id))}
                        title={`New ${t.name.toLowerCase()}`}
                      >
                        + new
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{entries.length}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {(unnamed > 0 || bare > 0) && (
            <p className="panel-note">
              {unnamed > 0 && `${unnamed} unnamed. `}
              {bare > 0 && `${bare} without a summary.`}
            </p>
          )}
        </section>

        <section className="panel">
          <h2>Recently edited</h2>
          {recent.length === 0 ? (
            <p className="panel-note">Nothing written yet. Pick a category on the left, or press Ctrl K and type a name.</p>
          ) : (
            <ul className="recent">
              {recent.map((e) => {
                const t = types.find((x) => x.id === e.typeId);
                return (
                  <li key={e.id}>
                    <button className="link" style={{ "--chip": t?.color } as React.CSSProperties} onClick={() => go({ view: "entry", id: e.id })}>
                      <EntryGlyph entry={e} size={13} /> {e.title || "Unnamed"}
                    </button>
                    <small>{relativeTime(e.updatedAt)}</small>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Writing</h2>
          {projects.length === 0 ? (
            <p className="panel-note">Books, campaigns and notes live here, right next to the lore they draw on.</p>
          ) : (
            <ul className="recent">
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="link" onClick={() => go({ view: "project", id: p.id })}>
                    {p.title}
                  </button>
                  <small>{p.kind}</small>
                </li>
              ))}
            </ul>
          )}
          <button className="ghost small" onClick={() => createProject("Untitled Book")}>
            New book
          </button>
        </section>
      </div>
    </div>
  );
}
