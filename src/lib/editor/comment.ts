import { Mark, mergeAttributes, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { create } from "zustand";

/** The manuscript editor currently open, so side panels can reach into it. */
export const useActiveEditor = create<{ editor: Editor | null; docId: string | null; focusedComment: string | null }>(() => ({
  editor: null,
  /** The chapter that editor is showing. */
  docId: null,
  focusedComment: null,
}));

/**
 * Anchors a comment to a passage. The comment's text lives outside the document,
 * so it never reaches exports, word counts or search.
 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  // Comments may overlap.
  excludes: "",
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute("data-comment"), renderHTML: (a) => ({ "data-comment": a.id }) } };
  },
  parseHTML() {
    return [{ tag: "span[data-comment]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "comment-mark" }), 0];
  },
});

/** Where a comment's passage is in the document (it may span several text nodes). */
export function commentRange(editor: Editor, id: string): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((m) => m.type.name === "comment" && m.attrs.id === id)) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
  });
  return from < 0 ? null : { from, to };
}

export function commentText(editor: Editor, id: string) {
  const r = commentRange(editor, id);
  return r ? editor.state.doc.textBetween(r.from, r.to, " ") : "";
}

/** Selects a comment's passage and scrolls it into view, without stealing focus. */
export function revealComment(editor: Editor, id: string) {
  const r = commentRange(editor, id);
  if (!r) return;
  const { tr } = editor.state;
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, r.from, r.to)).scrollIntoView());
}

export function removeCommentMark(editor: Editor, id: string) {
  const { tr, doc, schema } = editor.state;
  doc.descendants((node, pos) => {
    const mark = node.marks.find((m) => m.type.name === "comment" && m.attrs.id === id);
    if (node.isText && mark) tr.removeMark(pos, pos + node.nodeSize, mark);
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  void schema;
}
