import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { commentText, removeCommentMark, revealComment, useActiveEditor } from "../lib/editor/comment";
import { relativeTime } from "./EntryView";

type Comment = Awaited<ReturnType<typeof api.listComments>>[number];

/** Notes on the open chapter, in reading order. */
export function CommentsPanel({ docId, version, onChanged }: { docId: string; version: number; onChanged: () => void }) {
  const editor = useActiveEditor((s) => s.editor);
  const focused = useActiveEditor((s) => s.focusedComment);
  const [list, setList] = useState<Comment[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [, setTick] = useState(0);
  const timers = useRef(new Map<string, number>());

  const reload = () => api.listComments(docId).then(setList);
  useEffect(() => {
    reload();
  }, [docId, version]);

  // Re-render as the text changes, so quoted passages and order stay current.
  useEffect(() => {
    if (!editor) return;
    const tick = () => setTick((t) => t + 1);
    editor.on("update", tick);
    return () => void editor.off("update", tick);
  }, [editor]);

  // Order by where each passage sits in the chapter.
  const position = (id: string) => {
    if (!editor) return 0;
    let at = Number.MAX_SAFE_INTEGER;
    editor.state.doc.descendants((n, pos) => {
      if (at === Number.MAX_SAFE_INTEGER && n.isText && n.marks.some((m) => m.type.name === "comment" && m.attrs.id === id)) at = pos;
    });
    return at;
  };
  const visible = list.filter((c) => showResolved || !c.resolved).sort((a, b) => position(a.id) - position(b.id));

  const save = (c: Comment, patch: Partial<Comment>) => {
    const next = { ...c, ...patch };
    setList((l) => l.map((x) => (x.id === c.id ? next : x)));
    window.clearTimeout(timers.current.get(c.id));
    timers.current.set(
      c.id,
      window.setTimeout(() => api.saveComment(next).then(onChanged), patch.body !== undefined ? 500 : 0),
    );
  };

  const remove = async (c: Comment) => {
    if (editor) removeCommentMark(editor, c.id);
    await api.deleteComment(c.id);
    await reload();
    onChanged();
  };

  return (
    <aside className="lore comments-panel">
      <h3 className="side-title">Comments</h3>
      <label className="check inline-check">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        <span>Show resolved</span>
      </label>
      {visible.length === 0 && (
        <p className="hint">Select some text and press the comment button above the page (or Ctrl+Alt+M) to leave yourself a note.</p>
      )}
      <ul className="comment-list">
        {visible.map((c) => {
          const quote = editor ? commentText(editor, c.id) : "";
          return (
            <li
              key={c.id}
              className={`${focused === c.id ? "focused" : ""} ${c.resolved ? "resolved" : ""}`}
              ref={(el) => {
                if (el && focused === c.id) el.scrollIntoView({ block: "nearest" });
              }}
              onClick={() => (editor && revealComment(editor, c.id), useActiveEditor.setState({ focusedComment: c.id }))}
            >
              <blockquote>{quote ? (quote.length > 120 ? `${quote.slice(0, 120)}…` : quote) : <em>The passage was deleted</em>}</blockquote>
              <textarea
                autoFocus={focused === c.id && !c.body}
                value={c.body}
                placeholder="Write a note…"
                onChange={(e) => save(c, { body: e.target.value })}
                onClick={(e) => e.stopPropagation()}
              />
              <footer>
                <small>{relativeTime(c.createdAt)}</small>
                <span className="spacer" />
                <button className="link quiet" onClick={(e) => (e.stopPropagation(), save(c, { resolved: !c.resolved }))}>
                  {c.resolved ? "Reopen" : "Resolve"}
                </button>
                <button className="link quiet" onClick={(e) => (e.stopPropagation(), remove(c))}>
                  Delete
                </button>
              </footer>
            </li>
          );
        })}
      </ul>
      {/* Resolved comments keep their anchor but lose their highlight. */}
      <style>{list.filter((c) => c.resolved).map((c) => `[data-comment="${c.id}"]{background:none;border-bottom:0}`).join("")}</style>
    </aside>
  );
}
