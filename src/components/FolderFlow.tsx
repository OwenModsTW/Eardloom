import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { api } from "../lib/api";
import { useAutosave } from "../lib/useAutosave";
import { useActiveEditor } from "../lib/editor/comment";
import { snapshotBeforeFirstEdit } from "../lib/editor/autoSnapshot";
import { RichEditor } from "./RichEditor";
import { FormatBar } from "./FormatBar";
import type { Doc, DocSummary } from "../lib/types";

type Part = { kind: "heading"; doc: DocSummary; depth: number } | { kind: "text"; doc: DocSummary };

/** Everything inside a folder (or the whole book), in reading order. */
function partsOf(docs: DocSummary[], rootId: string | null): Part[] {
  const children = (parent: string | null) => docs.filter((d) => d.parentId === parent).sort((a, b) => a.sort - b.sort);
  const out: Part[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of children(parent)) {
      if (d.kind === "folder") {
        out.push({ kind: "heading", doc: d, depth });
        walk(d.id, depth + 1);
      } else out.push({ kind: "text", doc: d });
    }
  };
  walk(rootId, 0);
  return out;
}

/**
 * A folder's chapters (or the whole book) as one continuous document. Each chapter is still
 * its own document and saves on its own; editors load as they scroll into view.
 */
export function FolderFlow({
  folder,
  docs,
  bookTitle,
  onOpen,
  onSaved,
  onFocusDoc,
}: {
  /** The folder, or null for the whole book. */
  folder: DocSummary | null;
  docs: DocSummary[];
  bookTitle: string;
  onOpen: (docId: string) => void;
  onSaved: (patch: Partial<DocSummary> & { id: string }) => void;
  /** The chapter being edited, and how to save it right away. */
  onFocusDoc: (docId: string, flush: () => Promise<void>) => void;
}) {
  const parts = useMemo(() => partsOf(docs, folder?.id ?? null), [docs, folder?.id]);
  const [focused, setFocused] = useState<Editor | null>(null);
  const words = parts.reduce((n, p) => n + (p.kind === "text" ? p.doc.wordCount : 0), 0);
  const chapters = parts.filter((p) => p.kind === "text").length;

  return (
    <div className="doc flow">
      <header className="flow-head">
        <h1 className="doc-title">{folder ? folder.title || "Untitled folder" : bookTitle}</h1>
        <p className="hint">
          {chapters === 0
            ? "Nothing in here yet."
            : `${chapters} ${chapters === 1 ? "chapter" : "chapters"} · ${words.toLocaleString()} words. Read and edit them as one; each still saves on its own.`}
        </p>
      </header>
      <div className="flow-toolbar">
        {focused ? (
          <FormatBar
            editor={focused}
            manuscript
            // The chapter's own find bar opens on Ctrl+F.
            onFind={() => focused.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }))}
          />
        ) : (
          <p className="hint">Click into any chapter to start editing.</p>
        )}
      </div>
      {parts.map((p) =>
        p.kind === "heading" ? (
          <h2 key={p.doc.id} className={`flow-part depth-${Math.min(p.depth, 2)}`}>
            {p.doc.title || "Untitled folder"}
          </h2>
        ) : (
          <FlowSection
            key={p.doc.id}
            summary={p.doc}
            onOpen={() => onOpen(p.doc.id)}
            onSaved={onSaved}
            onFocus={(editor, flush) => (setFocused(editor), onFocusDoc(p.doc.id, flush))}
          />
        ),
      )}
    </div>
  );
}

function FlowSection({
  summary,
  onOpen,
  onSaved,
  onFocus,
}: {
  summary: DocSummary;
  onOpen: () => void;
  onSaved: (patch: Partial<DocSummary> & { id: string }) => void;
  onFocus: (editor: Editor, flush: () => Promise<void>) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const id = summary.id;

  // Load the chapter once it's close to being on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && (setNear(true), io.disconnect()), {
      root: el.closest(".manuscript"),
      rootMargin: "1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (near) api.getDoc(id).then(setDoc);
  }, [near, id]);

  const { schedule, flush } = useAutosave(async (d: Doc) => {
    const wordCount = await api.saveDoc(d);
    onSaved({ id: d.id, wordCount });
  });

  // Comments and assistant suggestions go to the chapter being edited.
  useEffect(
    () => () => {
      if (useActiveEditor.getState().docId === id) useActiveEditor.setState({ editor: null, docId: null, focusedComment: null });
    },
    [id],
  );

  // Roughly the chapter's height until it loads, so the scrollbar doesn't jump.
  const estimate = Math.max(120, Math.round(summary.wordCount / 11) * 28);

  return (
    <section ref={ref} className="flow-section">
      <h3 className="flow-title">
        <button className="link quiet" onClick={onOpen} title="Open this chapter on its own">
          {summary.title || "Untitled"}
        </button>
      </h3>
      {doc ? (
        <RichEditor
          content={doc.body}
          className="prose"
          manuscript
          secondary
          toolbar={false}
          onFocusEditor={(editor) => (useActiveEditor.setState({ editor, docId: id }), onFocus(editor, flush))}
          onChange={(body) => {
            snapshotBeforeFirstEdit(id, doc.wordCount);
            setDoc((prev) => {
              const next = { ...prev!, body };
              schedule(next);
              return next;
            });
          }}
        />
      ) : (
        <div className="flow-placeholder" style={{ height: estimate }} />
      )}
    </section>
  );
}
