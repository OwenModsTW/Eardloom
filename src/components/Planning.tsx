import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, Plus, Trash2 } from "lucide-react";
import { api, newId } from "../lib/api";
import { useStore } from "../store";
import { LABEL_COLORS, planOf, statusProgress, type Label, type PlanSettings, type Status } from "../lib/plan";
import { readingOrder } from "../lib/export/book";
import { Select } from "./Select";
import type { DocSummary, Project } from "../lib/types";

interface Props {
  project: Project;
  docs: DocSummary[];
  /** The folder whose contents the cards show (null = top level). */
  scope: string | null;
  setScope: (id: string | null) => void;
  patchDoc: (id: string, patch: Partial<DocSummary>) => void;
  openDoc: (id: string) => void;
  addDoc: (kind: "text" | "folder", parentId: string | null) => void;
  reload: () => Promise<unknown>;
}

const progressClass = (p: number) => (p >= 1 ? "done" : p >= 0.6 ? "late" : p > 0 ? "early" : "");

function StatusSelect({ statuses, value, onChange }: { statuses: Status[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select
      className={`inline status-select ${progressClass(statusProgress(statuses, value))}`}
      value={value}
      placeholder="No status"
      onChange={onChange}
      options={[{ value: "", label: <span className="placeholder">No status</span> }, ...statuses.map((s) => ({ value: s.id, label: s.name }))]}
    />
  );
}

function LabelSelect({ labels, value, onChange }: { labels: Label[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select
      className="inline label-select"
      value={value}
      placeholder="No label"
      onChange={onChange}
      options={[
        { value: "", label: <span className="placeholder">No label</span> },
        ...labels.map((l) => ({
          value: l.id,
          label: (
            <span className="label-option">
              <i style={{ background: l.color }} /> {l.name}
            </span>
          ),
        })),
      ]}
    />
  );
}

/** Saves card details right away and updates the binder without a reload. */
function useDetails(patchDoc: Props["patchDoc"]) {
  return (id: string, patch: { title?: string; synopsis?: string; status?: string; label?: string }) => {
    patchDoc(id, patch);
    api.updateDocDetails(id, patch).catch((e) => useStore.getState().notify(String(e)));
  };
}

export function CardsView({ project, docs, scope, setScope, patchDoc, openDoc, addDoc, reload }: Props) {
  const { statuses, labels, targets } = planOf(project);
  const save = useDetails(patchDoc);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const cards = useMemo(() => docs.filter((d) => d.parentId === scope).sort((a, b) => a.sort - b.sort), [docs, scope]);
  const trail = useMemo(() => {
    const out: DocSummary[] = [];
    let cur = docs.find((d) => d.id === scope);
    while (cur) {
      out.unshift(cur);
      cur = docs.find((d) => d.id === cur!.parentId);
    }
    return out;
  }, [docs, scope]);

  const drop = async (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const ids = cards.map((c) => c.id).filter((id) => id !== dragging);
    ids.splice(ids.indexOf(targetId), 0, dragging);
    await api.moveDocs(ids.map((id, i) => ({ id, parentId: scope, sort: i + 1 })));
    await reload();
  };

  return (
    <div className="cards-view">
      <nav className="plan-trail">
        <button className="link" onClick={() => setScope(null)}>
          {project.title}
        </button>
        {trail.map((t) => (
          <span key={t.id}>
            {" / "}
            <button className="link" onClick={() => setScope(t.id)}>
              {t.title || "Untitled"}
            </button>
          </span>
        ))}
      </nav>
      <div className="cards">
        {cards.map((c) => {
          const label = labels.find((l) => l.id === c.label);
          const target = targets[c.id];
          const children = docs.filter((d) => d.parentId === c.id);
          return (
            <article
              key={c.id}
              className={`index-card ${over === c.id ? "drop" : ""} ${dragging === c.id ? "dragging" : ""}`}
              style={{ "--label": label?.color ?? "transparent" } as React.CSSProperties}
              draggable
              onDragStart={() => setDragging(c.id)}
              onDragEnd={() => (setDragging(null), setOver(null))}
              onDragOver={(e) => (e.preventDefault(), setOver(c.id))}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => (e.preventDefault(), setOver(null), drop(c.id))}
            >
              <header>
                {c.kind === "folder" ? <Folder size={13} /> : <FileText size={13} />}
                <input value={c.title} placeholder="Untitled" onChange={(e) => save(c.id, { title: e.target.value })} />
                <button
                  className="link quiet"
                  onClick={() => (c.kind === "folder" ? setScope(c.id) : openDoc(c.id))}
                  title={c.kind === "folder" ? "Open folder" : "Write"}
                >
                  {c.kind === "folder" ? `${children.length} inside →` : "Write →"}
                </button>
              </header>
              <textarea
                value={c.synopsis}
                placeholder="What happens here?"
                onChange={(e) => save(c.id, { synopsis: e.target.value })}
              />
              <footer>
                <StatusSelect statuses={statuses} value={c.status} onChange={(status) => save(c.id, { status })} />
                <LabelSelect labels={labels} value={c.label} onChange={(l) => save(c.id, { label: l })} />
                {c.kind === "text" && (
                  <span className="card-words">
                    {c.wordCount.toLocaleString()}
                    {target ? ` / ${target.toLocaleString()}` : ""}
                  </span>
                )}
              </footer>
            </article>
          );
        })}
        <button className="index-card add-card" onClick={() => addDoc("text", scope)}>
          <Plus size={16} /> New card
        </button>
      </div>
    </div>
  );
}

export function OutlineView({ project, docs, patchDoc, openDoc }: Props) {
  const { statuses, labels, targets } = planOf(project);
  const save = useDetails(patchDoc);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const ordered = useMemo(() => readingOrder(docs), [docs]);
  const depth = (d: DocSummary): number => {
    const parent = docs.find((x) => x.id === d.parentId);
    return parent ? 1 + depth(parent) : 0;
  };
  const hidden = (d: DocSummary): boolean => {
    const parent = docs.find((x) => x.id === d.parentId);
    return !!parent && (closed.has(parent.id) || hidden(parent));
  };
  const total = docs.reduce((n, d) => n + d.wordCount, 0);
  const counted = (s: string) => docs.filter((d) => d.kind === "text" && d.status === s).length;

  return (
    <div className="outline-view">
      <div className="outline-summary">
        {statuses.map((s) => (
          <span key={s.id} className={progressClass(statusProgress(statuses, s.id))}>
            {s.name} <b>{counted(s.id)}</b>
          </span>
        ))}
        <span className="spacer" />
        <span>{total.toLocaleString()} words</span>
      </div>
      <table className="data-table outline">
        <thead>
          <tr>
            <th>Title</th>
            <th>Synopsis</th>
            <th>Status</th>
            <th>Label</th>
            <th className="num">Words</th>
          </tr>
        </thead>
        <tbody>
          {ordered
            .filter((d) => !hidden(d))
            .map((d) => {
              const label = labels.find((l) => l.id === d.label);
              const target = targets[d.id];
              const isFolder = d.kind === "folder";
              const words = isFolder ? docs.filter((x) => x.parentId === d.id).reduce((n, x) => n + x.wordCount, 0) : d.wordCount;
              return (
                <tr key={d.id} className={isFolder ? "folder-row" : ""} style={{ "--label": label?.color ?? "transparent" } as React.CSSProperties}>
                  <td className="outline-title" style={{ paddingLeft: 8 + depth(d) * 18 }}>
                    {isFolder ? (
                      <button
                        className="icon-btn"
                        onClick={() => {
                          const next = new Set(closed);
                          next.has(d.id) ? next.delete(d.id) : next.add(d.id);
                          setClosed(next);
                        }}
                      >
                        {closed.has(d.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </button>
                    ) : (
                      <button className="icon-btn" onClick={() => openDoc(d.id)} title="Write">
                        <FileText size={13} />
                      </button>
                    )}
                    <input value={d.title} placeholder="Untitled" onChange={(e) => save(d.id, { title: e.target.value })} />
                  </td>
                  <td>
                    <input className="outline-synopsis" value={d.synopsis} placeholder="—" onChange={(e) => save(d.id, { synopsis: e.target.value })} />
                  </td>
                  <td>{!isFolder && <StatusSelect statuses={statuses} value={d.status} onChange={(status) => save(d.id, { status })} />}</td>
                  <td>
                    <LabelSelect labels={labels} value={d.label} onChange={(l) => save(d.id, { label: l })} />
                  </td>
                  <td className="num">
                    {words.toLocaleString()}
                    {target ? (
                      <span className="outline-target">
                        <span style={{ width: `${Math.min(100, (words / target) * 100)}%` }} />
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/** Edit a book's statuses and labels. */
export function PlanSettingsPanel({ project, onClose }: { project: Project; onClose: () => void }) {
  const refreshProjects = useStore((s) => s.refreshProjects);
  const initial = planOf(project);
  const [statuses, setStatuses] = useState(initial.statuses);
  const [labels, setLabels] = useState(initial.labels);

  const persist = async (patch: Partial<PlanSettings>) => {
    await api.saveProject({ ...project, settings: { ...project.settings, ...patch } });
    await refreshProjects();
  };
  const setS = (next: Status[]) => (setStatuses(next), persist({ statuses: next }));
  const setL = (next: Label[]) => (setLabels(next), persist({ labels: next }));

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog plan-settings" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Statuses and labels">
        <header className="dialog-head">
          <h2>Statuses and labels</h2>
        </header>
        <div className="plan-settings-body">
          <section>
            <h3>Status</h3>
            <p className="hint">How finished each part is, in order from first to last.</p>
            {statuses.map((s, i) => (
              <div key={s.id} className="plan-row">
                <input value={s.name} onChange={(e) => setS(statuses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="icon-btn danger" onClick={() => setS(statuses.filter((_, j) => j !== i))} aria-label="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button className="ghost" onClick={() => setS([...statuses, { id: newId(), name: "New status" }])}>
              <Plus size={14} /> Add status
            </button>
          </section>
          <section>
            <h3>Labels</h3>
            <p className="hint">Colour-code anything: point of view, storyline, act, timeline.</p>
            {labels.map((l, i) => (
              <div key={l.id} className="plan-row">
                <input type="color" value={l.color} onChange={(e) => setL(labels.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
                <input value={l.name} onChange={(e) => setL(labels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <button className="icon-btn danger" onClick={() => setL(labels.filter((_, j) => j !== i))} aria-label="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button
              className="ghost"
              onClick={() => setL([...labels, { id: newId(), name: "New label", color: LABEL_COLORS[labels.length % LABEL_COLORS.length] }])}
            >
              <Plus size={14} /> Add label
            </button>
          </section>
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
