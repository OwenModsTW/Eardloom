import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookDeadline, TargetMeter } from "./WritingGoals";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown, ChevronRight, ExternalLink, FilePlus, FileText, Folder, FolderPlus, PanelRightClose,
  BookOpen, Clapperboard, Columns2, FileSearch, History, ListChecks, Maximize2, MessageSquare, Minimize2, PanelRightOpen, Search, Trash2,
} from "lucide-react";
import { api, newId } from "../lib/api";
import { useStore } from "../store";
import { TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { toParagraphs } from "../lib/text";
import { findInOpenEditor, findWhenOpened, MentionClickContext, RichEditor, type EditorStats } from "./RichEditor";
import { openMenu } from "./ContextMenu";
import { ExportBook } from "./ExportBook";
import { SnapshotPanel } from "./Snapshots";
import { CardsView, OutlineView, PlanSettingsPanel } from "./Planning";
import { CommentsPanel } from "./Comments";
import { SplitPane, type SplitTarget } from "./SplitPane";
import { FolderFlow } from "./FolderFlow";
import { BookFind } from "./BookFind";
import { ContinuityPanel, ScenePanel, ThreadsView } from "./Scenes";
import { snapshotBeforeFirstEdit } from "../lib/editor/autoSnapshot";
import { useActiveEditor } from "../lib/editor/comment";
import { planOf } from "../lib/plan";
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

/** Stands in for a document id: the whole book as one continuous document. */
const WHOLE_BOOK = "book";

/** Each book's word total when it was first opened this session, for "+N this session". */
const sessionStarts = new Map<string, number>();


/** Click to set a word target; shows progress once one is set. */
export function ProjectView({ id, docId }: { id: string; docId?: string }) {
  const project = useStore((s) => s.projects.find((p) => p.id === id));
  const { go, refreshProjects, focusMode, setFocusMode } = useStore();
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loreId, setLoreId] = useState<string | null>(null);
  // The panel beside the manuscript: lore, snapshots, comments or find in book.
  const [side, setSide] = useState<"lore" | "snaps" | "comments" | "find" | "scene" | "checks" | null>("lore");
  const toggleSide = (s: NonNullable<typeof side>) => setSide((cur) => (cur === s ? null : s));
  const loreOpen = side === "lore";
  const snapsOpen = side === "snaps";
  const commentsOpen = side === "comments";
  const findOpen = side === "find";
  const sceneOpen = side === "scene";
  const checksOpen = side === "checks";
  const modeKey = `eardloom.mode.${id}`;
  const [mode, setModeState] = useState<"write" | "cards" | "outline" | "threads">(() => {
    try {
      const m = localStorage.getItem(modeKey);
      return m === "cards" || m === "outline" || m === "threads" ? m : "write";
    } catch {
      return "write";
    }
  });
  const setMode = (m: "write" | "cards" | "outline" | "threads") => {
    setModeState(m);
    try {
      localStorage.setItem(modeKey, m);
    } catch {
      /* per-computer preference */
    }
  };
  const [scope, setScope] = useState<string | null>(null);
  const [planSettings, setPlanSettings] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editorRev, setEditorRev] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [commentVersion, setCommentVersion] = useState(0);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const focusedComment = useActiveEditor((s) => s.focusedComment);
  const [snapVersion, setSnapVersion] = useState(0);
  const flushDoc = useRef<() => Promise<void>>(() => Promise.resolve());
  // The side-by-side pane, remembered per book on this computer.
  const splitKey = `eardloom.split.${id}`;
  const [split, setSplitState] = useState<{ open: boolean; target: SplitTarget | null; width: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(splitKey) ?? "null");
      if (saved && typeof saved.width === "number") return saved;
    } catch {
      /* fall through */
    }
    return { open: false, target: null, width: 45 };
  });
  const setSplit = (patch: Partial<typeof split>) =>
    setSplitState((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(splitKey, JSON.stringify(next));
      } catch {
        /* per-computer preference */
      }
      return next;
    });
  const writingRef = useRef<HTMLDivElement>(null);
  const resize = (e: React.PointerEvent) => {
    const area = writingRef.current;
    if (!area) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const r = area.getBoundingClientRect();
      setSplitState((s) => ({ ...s, width: Math.min(70, Math.max(25, ((r.right - ev.clientX) / r.width) * 100)) }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSplit({});
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reload = useCallback(() => api.listDocs(id).then(setDocs), [id]);
  const reloadCounts = useCallback(() => api.commentCounts(id).then(setCommentCounts), [id]);
  useEffect(() => {
    reloadCounts();
  }, [reloadCounts, commentVersion]);
  useEffect(() => {
    if (focusedComment) setSide("comments");
  }, [focusedComment]);
  useEffect(() => {
    reload();
  }, [reload]);

  const tree = useMemo(() => buildTree(docs), [docs]);
  const activeId = docId ?? docs.find((d) => d.kind === "text")?.id;
  const activeDoc = docs.find((d) => d.id === activeId);
  // A folder (or the whole book) opens as one continuous document.
  const flowing = activeId === WHOLE_BOOK || activeDoc?.kind === "folder";
  const [flowFocus, setFlowFocus] = useState<string | null>(null);
  useEffect(() => setFlowFocus(null), [activeId]);
  /** The chapter that comments, snapshots and Ctrl+S apply to. */
  const panelDocId = flowing ? (flowFocus ?? undefined) : activeId;
  /** Chapters being edited in the main area (so the side pane doesn't open them twice). */
  const mainDocIds = useMemo(() => {
    if (!flowing) return activeId ? [activeId] : [];
    const root = activeId === WHOLE_BOOK ? null : activeId!;
    const inside = (d: DocSummary): boolean => {
      for (let p = d.parentId; p; p = docs.find((x) => x.id === p)?.parentId ?? null) if (p === root) return true;
      return root === null;
    };
    return docs.filter((d) => d.kind === "text" && inside(d)).map((d) => d.id);
  }, [flowing, activeId, docs]);
  const activeRef = useRef(panelDocId);
  activeRef.current = panelDocId;
  const total = docs.reduce((n, d) => n + d.wordCount, 0);
  useEffect(() => {
    if (docs.length && !sessionStarts.has(id)) sessionStarts.set(id, total);
  }, [docs.length, id, total]);
  const session = total - (sessionStarts.get(id) ?? total);

  useEffect(() => {
    const addComment = async () => {
      const editor = useActiveEditor.getState().editor;
      const docId = activeRef.current;
      if (!editor || !docId) return;
      const { from, to } = editor.state.selection;
      if (from === to) return useStore.getState().notify("Select the text you want to comment on first.");
      const commentId = newId();
      editor.chain().focus().setMark("comment", { id: commentId }).run();
      await api.saveComment({ id: commentId, docId, body: "", resolved: false });
      setSide("comments");
      setCommentVersion((v) => v + 1);
      useActiveEditor.setState({ focusedComment: commentId });
    };
    window.addEventListener("eardloom:comment", addComment);
    return () => window.removeEventListener("eardloom:comment", addComment);
  }, []);

  // F11 toggles focus mode; Escape leaves it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "F11") (e.preventDefault(), setFocusMode(!useStore.getState().focusMode));
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("eardloom:comment"));
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSide("find");
      }
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

  const settings = project.settings as { targets?: Record<string, number>; bookTarget?: number; deadline?: string };
  const plan = planOf(project);
  const patchDoc = (docId: string, patch: Partial<DocSummary>) => setDocs((ds) => ds.map((d) => (d.id === docId ? { ...d, ...patch } : d)));
  const planProps = {
    project,
    docs,
    scope,
    setScope,
    patchDoc,
    openDoc: (docId: string) => (setMode("write"), open(docId)),
    addDoc: (kind: "text" | "folder", parentId: string | null) => add(kind, undefined, parentId),
    reload,
  };
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
  const showSplit = split.open && mode === "write" && !focusMode;
  const toggleSplit = () => {
    // Side by side needs the room, so the lore panel steps aside.
    if (!split.open) setSide(null);
    setSplit({ open: !split.open });
  };
  const openMention = (entryId: string) => {
    if (showSplit) return setSplit({ target: { kind: "entry", id: entryId } });
    setLoreId(entryId);
    setSide("lore");
  };

  const add = async (kind: "text" | "folder", near?: DocSummary, inParent?: string | null) => {
    const anchor = near ?? docs.find((d) => d.id === activeId);
    // New items go inside a folder, or next to a document (unless a parent is given).
    const parentId = inParent !== undefined ? inParent : anchor?.kind === "folder" ? anchor.id : (anchor?.parentId ?? null);
    const siblings = docs.filter((d) => d.parentId === parentId);
    const doc: Doc = {
      id: newId(),
      projectId: id,
      parentId,
      kind,
      title: kind === "folder" ? "New Folder" : `Chapter ${docs.filter((d) => d.kind === "text").length + 1}`,
      synopsis: "",
      status: "",
      label: "",
      body: null,
      sort: Math.max(0, ...siblings.map((s) => s.sort)) + 1,
      wordCount: 0,
      meta: {},
    };
    await api.saveDoc(doc);
    await reload();
    if (inParent !== undefined) return;
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
          onClick={() => (isFolder ? (mode === "cards" ? setScope(n.id) : mode === "write" && open(n.id)) : (open(n.id), mode === "cards" && setMode("write")))}
          onContextMenu={(e) =>
            openMenu(e, [
              ...(isFolder ? [{ label: "Read as one document", onClick: () => (setMode("write"), open(n.id)) }, "separator" as const] : []),
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
          {commentCounts[n.id] ? <span className="binder-comments" title="Unresolved comments">{commentCounts[n.id]}</span> : null}
          {n.label && <i className="binder-label" style={{ background: plan.labels.find((l) => l.id === n.label)?.color }} />}
          {!isFolder && n.wordCount > 0 && <small>{n.wordCount.toLocaleString()}</small>}
        </div>
        {isFolder && !shut && n.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className={`project ${side && !focusMode ? "with-lore" : ""} ${focusMode ? "focus" : ""}`}>
      <aside className="binder">
        <ProjectTitle project={project} onSaved={refreshProjects} />
        <div className="binder-actions">
          <button className="icon-btn" onClick={() => add("text")} title="New document">
            <FilePlus size={14} />
          </button>
          <button className="icon-btn" onClick={() => add("folder")} title="New folder">
            <FolderPlus size={14} />
          </button>
          <button
            className={`icon-btn ${activeId === WHOLE_BOOK ? "on" : ""}`}
            onClick={() => (setMode("write"), open(WHOLE_BOOK))}
            title="Read and edit the whole book as one document"
          >
            <BookOpen size={14} />
          </button>
          <span className="spacer" />
          <small>
            {total.toLocaleString()} words
            {session > 0 && <span className="session"> · +{session.toLocaleString()} this session</span>}
          </small>
          <button className="ghost tiny" onClick={() => setExporting(true)} title="Export as ebook, print-ready PDF, Word or Markdown">
            Export
          </button>
        </div>
        <div className="binder-tree">{tree.map((n) => renderNode(n, 0))}</div>
        <div className="binder-foot">
          <TargetMeter label="book" words={total} target={settings.bookTarget} onChange={(bookTarget) => saveSettings({ bookTarget })} />
          <BookDeadline project={project} total={total} onChange={(deadline) => saveSettings({ deadline })} />
        </div>
      </aside>

      <div
        ref={writingRef}
        className={`writing-area ${showSplit ? "split" : ""}`}
        style={{ "--split": `${split.width}%` } as React.CSSProperties}
      >
      <MentionClickContext.Provider value={openMention}>
        <main className={`manuscript mode-${mode}`}>
          {!focusMode && (
            <div className="mode-bar">
              <div className="segmented">
                {(["write", "cards", "outline", "threads"] as const).map((m) => (
                  <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                    {m === "write" ? "Write" : m === "cards" ? "Cards" : m === "outline" ? "Outline" : "Threads"}
                  </button>
                ))}
              </div>
              {mode !== "write" && (
                <button className="link quiet" onClick={() => setPlanSettings(true)}>
                  Statuses and labels…
                </button>
              )}
            </div>
          )}
          <div className="manuscript-tools">
            <button className="icon-btn" onClick={() => setFocusMode(!focusMode)} title={focusMode ? "Leave focus mode (Esc)" : "Focus mode (F11)"}>
              {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            {!focusMode && (
              <button
                className={`icon-btn ${commentsOpen ? "on" : ""}`}
                onClick={() => toggleSide("comments")}
                title="Comments"
              >
                <MessageSquare size={15} />
                {panelDocId && commentCounts[panelDocId] ? <span className="tool-badge">{commentCounts[panelDocId]}</span> : null}
              </button>
            )}
            {!focusMode && (
              <button className={`icon-btn ${sceneOpen ? "on" : ""}`} onClick={() => toggleSide("scene")} title="Scene: who, where, when and plot threads">
                <Clapperboard size={15} />
              </button>
            )}
            {!focusMode && (
              <button className={`icon-btn ${checksOpen ? "on" : ""}`} onClick={() => toggleSide("checks")} title="Continuity checks for this book">
                <ListChecks size={15} />
              </button>
            )}
            {!focusMode && (
              <button className={`icon-btn ${findOpen ? "on" : ""}`} onClick={() => toggleSide("find")} title="Find in book (Ctrl+Shift+F)">
                <FileSearch size={15} />
              </button>
            )}
            {!focusMode && (
              <button
                className={`icon-btn ${snapsOpen ? "on" : ""}`}
                onClick={() => toggleSide("snaps")}
                title="Snapshots (Ctrl+S to take one)"
              >
                <History size={15} />
              </button>
            )}
            {!focusMode && mode === "write" && (
              <button className={`icon-btn ${split.open ? "on" : ""}`} onClick={toggleSplit} title="Side by side: open an entry, chapter or map beside this one">
                <Columns2 size={15} />
              </button>
            )}
            {!focusMode && (
              <button className="icon-btn" onClick={() => toggleSide("lore")} title="Toggle lore panel">
                {loreOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
              </button>
            )}
          </div>
          {mode === "cards" ? (
            <CardsView {...planProps} />
          ) : mode === "outline" ? (
            <OutlineView {...planProps} />
          ) : mode === "threads" ? (
            <ThreadsView project={project} docs={docs} patchDoc={patchDoc} openDoc={planProps.openDoc} />
          ) : flowing ? (
            <FolderFlow
              key={`${activeId}-${editorRev}`}
              folder={activeId === WHOLE_BOOK ? null : activeDoc!}
              docs={docs}
              bookTitle={project.title}
              onOpen={open}
              onSaved={(patch) => setDocs((ds) => ds.map((d) => (d.id === patch.id ? { ...d, ...patch } : d)))}
              onFocusDoc={(focusId, flush) => (setFlowFocus(focusId), (flushDoc.current = flush))}
            />
          ) : activeId ? (
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
      {showSplit && (
        <>
          <div className="split-resizer" onPointerDown={resize} role="separator" aria-orientation="vertical" title="Drag to resize" />
          <MentionClickContext.Provider value={(entryId) => setSplit({ target: { kind: "entry", id: entryId } })}>
            <SplitPane
              target={split.target}
              docs={docs}
              mainDocIds={mainDocIds}
              onChange={(target) => setSplit({ target })}
              onClose={() => setSplit({ open: false })}
              renderDoc={(docId) => (
                <DocEditor
                  key={docId}
                  id={docId}
                  secondary
                  target={settings.targets?.[docId]}
                  onTarget={(n) => setDocTarget(docId, n)}
                  onSaved={(patch) => setDocs((ds) => ds.map((d) => (d.id === patch.id ? { ...d, ...patch } : d)))}
                />
              )}
            />
          </MentionClickContext.Provider>
        </>
      )}
      </div>

      {loreOpen && !focusMode && <LorePanel entryId={loreId} onPick={setLoreId} />}
      {commentsOpen && !focusMode && mode === "write" &&
        (panelDocId ? (
          <CommentsPanel docId={panelDocId} version={commentVersion} onChanged={() => setCommentVersion((v) => v + 1)} />
        ) : (
          <aside className="lore">
            <p className="hint">Click into a chapter to see its comments.</p>
          </aside>
        ))}
      {sceneOpen && !focusMode && (() => {
        const doc = docs.find((d) => d.id === panelDocId && d.kind === "text");
        return doc ? (
          <ScenePanel key={doc.id} project={project} doc={doc} patchDoc={patchDoc} />
        ) : (
          <aside className="lore">
            <p className="hint">Open a chapter to see its scene details.</p>
          </aside>
        );
      })()}
      {checksOpen && !focusMode && <ContinuityPanel project={project} docs={docs} onOpen={(d) => (setMode("write"), open(d))} />}
      {findOpen && !focusMode && (
        <BookFind
          docs={docs}
          flush={() => flushDoc.current()}
          onOpen={(target, term) => {
            setMode("write");
            if (target === activeId) findInOpenEditor(term);
            else (findWhenOpened(term), open(target));
          }}
          onChanged={() => (reload(), setSnapVersion((v) => v + 1))}
        />
      )}
      {planSettings && <PlanSettingsPanel project={project} onClose={() => setPlanSettings(false)} />}
      {snapsOpen && !focusMode && !panelDocId && (
        <aside className="lore">
          <p className="hint">Click into a chapter to see its snapshots.</p>
        </aside>
      )}
      {snapsOpen && !focusMode && panelDocId && (
        <SnapshotPanel
          key={panelDocId}
          docId={panelDocId}
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
  secondary,
}: {
  id: string;
  target?: number;
  onTarget: (n: number | undefined) => void;
  registerFlush?: (flush: () => Promise<void>) => void;
  onSaved: (patch: Partial<DocSummary> & { id: string }) => void;
  /** Shown in the side pane: comments, snapshots and assistant suggestions stay with the main chapter. */
  secondary?: boolean;
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
  useEffect(() => registerFlush?.(flush), [flush]);
  // Lets AI suggestions for this chapter go into the live editor.
  useEffect(() => {
    if (secondary) return;
    useActiveEditor.setState({ docId: id });
    return () => {
      if (useActiveEditor.getState().docId === id) useActiveEditor.setState({ docId: null });
    };
  }, [id]);

  if (!doc) return null;
  const update = (patch: Partial<Doc>) => {
    if (patch.body) snapshotBeforeFirstEdit(id, doc.wordCount);
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
            secondary={secondary}
            autofocus={!secondary}
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
            <span title="Standard manuscript pages (about 250 words each)">
              ~{Math.max(1, Math.ceil(stats.words / 250)).toLocaleString()} {Math.ceil(stats.words / 250) > 1 ? "pages" : "page"}
            </span>
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
