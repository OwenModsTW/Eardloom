import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown, ChevronRight, ExternalLink, FilePlus, FileText, Folder, FolderPlus, PanelRightClose,
  History, Maximize2, Minimize2, PanelRightOpen, Search, Trash2,
} from "lucide-react";
import { api, newId } from "../lib/api";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { toParagraphs } from "../lib/text";
import { MentionClickContext, RichEditor, type EditorStats } from "./RichEditor";
import { openMenu } from "./ContextMenu";
import { ExportBook } from "./ExportBook";
import { SnapshotPanel } from "./Snapshots";
import { assetUrl } from "./EntryView";
import { EntryGlyph } from "./EntryIcon";
import type { Doc, DocSummary, Entry, FieldValue, Project, WorldDate } from "../lib/types";
import { formatDate } from "../lib/calendar";

interface TreeNode extends DocSummary {
  children: TreeNode[];
}

function buildTree(docs: DocSummary[]): TreeNode[] {
  const nodes = new Map(docs.map((d) => [d.id, { ...d, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const n of [...nodes.values()].sort((a, b) => a.sort - b.sort)) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

type Drop = { targetId: string; where: "before" | "after" | "inside" };

/** Each book's word total when it was first opened this session, for "+N this session". */
const sessionStarts = new Map<string, number>();

/** Documents already given an automatic snapshot this session. */
const autoSnapped = new Set<string>();

/** Click to set a word target; shows progress once one is set. */
function TargetMeter({ words, target, onChange, label }: { words: number; target?: number; onChange: (n: number | undefined) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        className="target-input"
        autoFocus
        inputMode="numeric"
        defaultValue={target ?? ""}
        placeholder="Words"
        onBlur={(e) => {
          const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
          onChange(Number.isFinite(n) && n > 0 ? n : undefined);
          setEditing(false);
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
      />
    );
  if (!target)
    return (
      <button className="link quiet" onClick={() => setEditing(true)}>
        Set {label} target
      </button>
    );
  const pct = Math.min(100, Math.round((words / target) * 100));
  return (
    <button className={`target ${pct >= 100 ? "done" : ""}`} onClick={() => setEditing(true)} title={`${label} target: click to change`}>
      <span className="target-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      {pct}% of {target.toLocaleString()}
    </button>
  );
}

export function ProjectView({ id, docId }: { id: string; docId?: string }) {
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const { go, refreshProjects, focusMode, setFocusMode } = useStore();
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loreId, setLoreId] = useState<string | null>(null);
  const [loreOpen, setLoreOpen] = useState(true);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editorRev, setEditorRev] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [snapsOpen, setSnapsOpen] = useState(false);
  const [snapVersion, setSnapVersion] = useState(0);
  const flushDoc = useRef<() => Promise<void>>(() => Promise.resolve());

  const reload = useCallback(() => api.listDocs(id).then(setDocs), [id]);
  useEffect(() => {
    reload();
  }, [reload]);

  const tree = useMemo(() => buildTree(docs), [docs]);
  const activeId = docId ?? docs.find((d) => d.kind === "text")?.id;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const total = docs.reduce((n, d) => n + d.wordCount, 0);
  useEffect(() => {
    if (docs.length && !sessionStarts.has(id)) sessionStarts.set(id, total);
  }, [docs.length, id, total]);
  const session = total - (sessionStarts.get(id) ?? total);

  // F11 toggles focus mode; Escape leaves it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "F11") (e.preventDefault(), setFocusMode(!useStore.getState().focusMode));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const docId = activeRef.current;
        if (docId)
          flushDoc.current()
            .then(() => api.createSnapshot(docId, ""))
            .then(() => (setSnapVersion((v) => v + 1), useStore.getState().notify("Snapshot saved")));
      }
      if (e.key === "Escape" && useStore.getState().focusMode && !document.querySelector(".find-bar, .overlay, .menu")) setFocusMode(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setFocusMode]);

  if (!project) return <p className="page-note">This project no longer exists.</p>;

  const settings = project.settings as { targets?: Record<string, number>; bookTarget?: number };
  const saveSettings = async (patch: Partial<typeof settings>) => {
    await api.saveProject({ ...project, settings: { ...project.settings, ...patch } });
    await refreshProjects();
  };
  const setDocTarget = (docId: string, n: number | undefined) => {
    const targets = { ...(settings.targets ?? {}) };
    if (n) targets[docId] = n;
    else delete targets[docId];
    saveSettings({ targets });
  };

  const open = (doc: string) => go({ view: "project", id, docId: doc });

  const add = async (kind: "text" | "folder", near?: DocSummary) => {
    const anchor = near ?? docs.find((d) => d.id === activeId);
    // New items go inside a folder, or next to a document.
    const parentId = anchor?.kind === "folder" ? anchor.id : (anchor?.parentId ?? null);
    const siblings = docs.filter((d) => d.parentId === parentId);
    const doc: Doc = {
      id: newId(),
      projectId: id,
      parentId,
      kind,
      title: kind === "folder" ? "New Folder" : `Chapter ${docs.filter((d) => d.kind === "text").length + 1}`,
      synopsis: "",
      status: "",
      body: null,
      sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
      wordCount: 0,
    };
    await api.saveDoc(doc);
    await reload();
    if (kind === "text") open(doc.id);
    else setRenaming(doc.id);
  };

  const rename = async (id: string, title: string) => {
    setRenaming(null);
    const doc = await api.getDoc(id);
    if (!title.trim() || doc.title === title) return;
    await api.saveDoc({ ...doc, title: title.trim() });
    await reload();
    if (id === activeId) setEditorRev((r) => r + 1);
  };

  const remove = async (d: DocSummary) => {
    const what = d.kind === "folder" ? `the folder "${d.title}" and everything in it` : `"${d.title}"`;
    if (!(await ask(`Delete ${what}?`, { title: "Delete", kind: "warning" }))) return;
    await api.deleteDoc(d.id);
    await reload();
    if (d.id === activeId) go({ view: "project", id });
  };

  const isInside = (childId: string, ancestorId: string): boolean => {
    let cur = docs.find((d) => d.id === childId);
    while (cur?.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = docs.find((d) => d.id === cur!.parentId);
    }
    return false;
  };

  const commitDrop = async () => {
    if (!drag || !drop || drag === drop.targetId || isInside(drop.targetId, drag)) return;
    const target = docs.find((d) => d.id === drop.targetId)!;
    const parentId = drop.where === "inside" ? target.id : target.parentId;
    const siblings = docs
      .filter((d) => d.parentId === parentId && d.id !== drag)
      .sort((a, b) => a.sort - b.sort)
      .map((d) => d.id);
    const at = drop.where === "inside" ? siblings.length : siblings.indexOf(target.id) + (drop.where === "after" ? 1 : 0);
    siblings.splice(at, 0, drag);
    await api.moveDocs(siblings.map((sid, i) => ({ id: sid, parentId, sort: i + 1 })));
    await reload();
  };

  const renderNode = (n: TreeNode, depth: number) => {
    const isFolder = n.kind === "folder";
    const shut = collapsed.has(n.id);
    const marker = drop?.targetId === n.id ? `drop-${drop.where}` : "";
    return (
      <div key={n.id}>
        <div
          className={`binder-row ${n.id === activeId ? "active" : ""} ${marker}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={(e) => (setDrag(n.id), e.dataTransfer.setData("text/plain", n.id))}
          onDragEnd={() => (setDrag(null), setDrop(null))}
          onDragOver={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            setDrop({ targetId: n.id, where: isFolder && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "before" : "after" });
          }}
          onDrop={(e) => (e.preventDefault(), commitDrop().finally(() => (setDrag(null), setDrop(null))))}
          onClick={() => (isFolder ? null : open(n.id))}
          onContextMenu={(e) =>
            openMenu(e, [
              { label: "New document here", onClick: () => add("text", n) },
              { label: "New folder here", onClick: () => add("folder", n) },
              "separator",
              { label: "Rename", shortcut: "F2", onClick: () => setRenaming(n.id) },
              { label: "Delete", danger: true, onClick: () => remove(n) },
            ])
          }
          onKeyDown={(e) => e.key === "F2" && setRenaming(n.id)}
          tabIndex={0}
        >
          {isFolder ? (
            <button
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation();
                const next = new Set(collapsed);
                shut ? next.delete(n.id) : next.add(n.id);
                setCollapsed(next);
              }}
            >
              {shut ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
          ) : (
            <span className="binder-spacer" />
          )}
          {isFolder ? <Folder size={14} /> : <FileText size={14} />}
          {renaming === n.id ? (
            <input
              className="binder-rename"
              autoFocus
              defaultValue={n.title}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => rename(n.id, e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span className="binder-title" onDoubleClick={() => setRenaming(n.id)}>
              {n.title || "Untitled"}
            </span>
          )}
          {!isFolder && n.wordCount > 0 && <small>{n.wordCount.toLocaleString()}</small>}
        </div>
        {isFolder && !shut && n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className={`project ${(loreOpen || snapsOpen) && !focusMode ? "with-lore" : ""} ${focusMode ? "focus" : ""}`}>
      <aside className="binder">
        <ProjectTitle project={project} onSaved={refreshProjects} />
        <div className="binder-actions">
          <button className="icon-btn" onClick={() => add("text")} title="New document">
            <FilePlus size={14} />
          </button>
          <button className="icon-btn" onClick={() => add("folder")} title="New folder">
            <FolderPlus size={14} />
          </button>
          <span className="spacer" />
          <small>
            {total.toLocaleString()} words
            {session > 0 && <span className="session"> · +{session.toLocaleString()} this session</span>}
          </small>
          <button className="ghost tiny" onClick={() => setExporting(true)} title="Export as ebook, Word or Markdown">
            Export
          </button>
        </div>
        <div className="binder-tree">{tree.map((n) => renderNode(n, 0))}</div>
        <div className="binder-foot">
          <TargetMeter label="book" words={total} target={settings.bookTarget} onChange={(bookTarget) => saveSettings({ bookTarget })} />
        </div>
      </aside>

      <MentionClickContext.Provider value={(entryId) => (setLoreId(entryId), setLoreOpen(true), setSnapsOpen(false))}>
        <main className="manuscript">
          <div className="manuscript-tools">
            <button className="icon-btn" onClick={() => setFocusMode(!focusMode)} title={focusMode ? "Leave focus mode (Esc)" : "Focus mode (F11)"}>
              {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            {!focusMode && (
              <button
                className={`icon-btn ${snapsOpen ? "on" : ""}`}
                onClick={() => (setSnapsOpen(!snapsOpen), setLoreOpen(false))}
                title="Snapshots (Ctrl+S to take one)"
              >
                <History size={15} />
              </button>
            )}
            {!focusMode && (
              <button className="icon-btn" onClick={() => (setLoreOpen(!loreOpen), setSnapsOpen(false))} title="Toggle lore panel">
                {loreOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
          </div>
          {activeId ? (
            <DocEditor
              key={`${activeId}-${editorRev}`}
              id={activeId}
              target={settings.targets?.[activeId]}
              registerFlush={(f) => (flushDoc.current = f)}
              onTarget={(n) => setDocTarget(activeId, n)}
              onSaved={(patch) => setDocs((ds) => ds.map((d) => (d.id === patch.id ? { ...d, ...patch } : d)))}
            />
          ) : (
            <div className="blank-slate">
              <button className="primary" onClick={() => add("text")}>
                <FilePlus size={15} /> Start your first chapter
              </button>
            </div>
          )}
        </main>
      </MentionClickContext.Provider>

      {loreOpen && !focusMode && <LorePanel entryId={loreId} onPick={setLoreId} />}
      {snapsOpen && !focusMode && activeId && (
        <SnapshotPanel
          docId={activeId}
          version={snapVersion}
          flush={() => flushDoc.current()}
          onRestored={() => (setEditorRev((r) => r + 1), reload())}
        />
      )}
      {exporting && <ExportBook project={project} onClose={() => setExporting(false)} />}
    </div>
  );
}

function ProjectTitle({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [title, setTitle] = useState(project.title);
  const { go } = useStore();
  const { schedule } = useAutosave(async (t: string) => (await api.saveProject({ ...project, title: t }), onSaved()));
  const remove = async () => {
    if (!(await ask(`Delete "${project.title}" and all of its documents?`, { title: "Delete project", kind: "warning" }))) return;
    await api.deleteProject(project.id);
    onSaved();
    go({ view: "dashboard" });
  };
  return (
    <div className="project-title">
      <input value={title} onChange={(e) => (setTitle(e.target.value), schedule(e.target.value))} />
      <button className="icon-btn hover-only" onClick={remove} aria-label="Delete project">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function DocEditor({
  id,
  target,
  onTarget,
  registerFlush,
  onSaved,
}: {
  id: string;
  target?: number;
  onTarget: (n: number | undefined) => void;
  registerFlush: (flush: () => Promise<void>) => void;
  onSaved: (patch: Partial<DocSummary> & { id: string }) => void;
}) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [stats, setStats] = useState<EditorStats>({ words: 0, characters: 0, selectedWords: 0 });
  useEffect(() => {
    api.getDoc(id).then((d) => (setDoc(d), setStats((s) => ({ ...s, words: d.wordCount }))));
  }, [id]);

  const { schedule, flush } = useAutosave(async (d: Doc) => {
    const wordCount = await api.saveDoc(d);
    onSaved({ id: d.id, title: d.title, synopsis: d.synopsis, status: d.status, wordCount });
  });
  useEffect(() => registerFlush(flush), [flush]);

  if (!doc) return null;
  const update = (patch: Partial<Doc>) => {
    // Keep the version from before this session's first edit, as a safety net.
    if (patch.body && !autoSnapped.has(id)) {
      autoSnapped.add(id);
      if (doc.wordCount > 0) api.createSnapshot(id, "", true).catch(() => {});
    }
    setDoc((prev) => {
      const next = { ...prev!, ...patch };
      schedule(next);
      return next;
    });
  };

  return (
    <div className="doc">
      <input className="doc-title" value={doc.title} placeholder="Untitled" onChange={(e) => update({ title: e.target.value })} />
      <input
        className="doc-synopsis"
        value={doc.synopsis}
        placeholder="Synopsis: what happens here?"
        onChange={(e) => update({ synopsis: e.target.value })}
      />
      {doc.kind === "folder" ? (
        <p className="hint">This is a folder. Drag documents onto it to organise your manuscript.</p>
      ) : (
        <>
          <RichEditor
            content={doc.body}
            className="prose"
            manuscript
            autofocus
            onStats={setStats}
            onChange={(body) => update({ body })}
          />
          <footer className="doc-footer">
            <span>
              {stats.selectedWords > 0 && <strong>{stats.selectedWords.toLocaleString()} of </strong>}
              {stats.words.toLocaleString()} words
            </span>
            <span>{stats.characters.toLocaleString()} characters</span>
            <span>{Math.max(1, Math.round(stats.words / 250))} min read</span>
            <TargetMeter label="chapter" words={stats.words} target={target} onChange={onTarget} />
          </footer>
        </>
      )}
    </div>
  );
}

function LorePanel({ entryId, onPick }: { entryId: string | null; onPick: (id: string | null) => void }) {
  const { entries, types, go, calendar } = useStore();
  const world = useStore((s) => s.world)!;
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    if (entryId) api.getEntry(entryId).then(setEntry, () => setEntry(null));
    else setEntry(null);
  }, [entryId]);

  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return entries.filter((e) => [e.title, ...e.aliases, ...e.tags].some((s) => s.toLowerCase().includes(q))).slice(0, 12);
  }, [entries, query]);

  const type = types.find((t) => t.id === entry?.typeId);
  const display = (v: FieldValue | undefined, kind: string): React.ReactNode => {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return null;
    if (kind === "entry" || kind === "entries") {
      const ids = Array.isArray(v) ? v : [String(v)];
      return ids.map((x) => {
        const e = entries.find((y) => y.id === x);
        return e ? (
          <button key={x} className="link" onClick={() => onPick(x)}>
            {e.title}
          </button>
        ) : null;
      });
    }
    if (kind === "worlddate") return formatDate(calendar, v as WorldDate) || null;
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "object" && !Array.isArray(v)) return toParagraphs(v).join(" ");
    return Array.isArray(v) ? v.join(", ") : String(v);
  };

  return (
    <aside className="lore">
      <div className="search-inline">
        <Search size={14} />
        <input placeholder="Look something up…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {matches.length > 0 && (
        <ul className="lore-results">
          {matches.map((m) => {
            return (
              <li key={m.id}>
                <button onClick={() => (onPick(m.id), setQuery(""))}>
                  <EntryGlyph entry={m} size={13} /> {m.title}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {entry ? (
        <div className="lore-card">
          {entry.image && <img src={assetUrl(world.assetsPath, entry.image)!} alt="" />}
          <div className="lore-type" style={{ color: type?.color }}>
            <TypeIcon name={type?.icon ?? ""} size={13} /> {type?.name}
          </div>
          <h3>
            {entry.emoji && <span className="title-emoji">{entry.emoji}</span>}
            {entry.title}
          </h3>
          {entry.aliases.length > 0 && <p className="hint">aka {entry.aliases.join(", ")}</p>}
          {entry.summary && <p className="lore-summary">{entry.summary}</p>}
          <dl>
            {type?.fields.map((f) => {
              const shown = display(entry.fields[f.id], f.kind);
              return shown ? (
                <div key={f.id}>
                  <dt>{f.label}</dt>
                  <dd>{shown}</dd>
                </div>
              ) : null;
            })}
          </dl>
          <div className="lore-body">
            {toParagraphs(entry.body).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <button className="ghost" onClick={() => go({ view: "entry", id: entry.id })}>
            <ExternalLink size={13} /> Open full entry
          </button>
        </div>
      ) : (
        !matches.length && <p className="hint">Search your codex, or click any @mention in your manuscript to see it here.</p>
      )}
    </aside>
  );
}
