import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  ReactRenderer,
  useEditor,
  type JSONContent,
  type NodeViewProps,
} from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Typography from "@tiptap/extension-typography";
import Mention from "@tiptap/extension-mention";
import { CharacterCount, Focus, Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { useStore } from "../store";
import { EntryGlyph } from "./EntryIcon";
import { TypeIcon } from "../lib/icons";
import { createEntry } from "../lib/actions";
import { FormatBar } from "./FormatBar";
import { FindBar } from "./FindBar";
import { Search } from "../lib/editor/search";
import { Spellcheck } from "../lib/editor/spellcheck";
import { CommentMark, useActiveEditor } from "../lib/editor/comment";
import { ignoreWord, suggestions } from "../lib/spell";
import { openMenuAt } from "./ContextMenu";
import { rtfToContent } from "../lib/editor/rtf";
import { Slice } from "@tiptap/pm/model";
import { api } from "../lib/api";
import { getManuscriptLook } from "../lib/prefs";
import type { EntrySummary } from "../lib/types";

/** Lets the surrounding view decide what clicking a mention does (navigate, open in side panel...). */
export const MentionClickContext = createContext<(id: string) => void>(() => {});

function MentionChip({ node }: NodeViewProps) {
  const id = node.attrs.id as string;
  const entry = useStore((s) => s.entries.find((e) => e.id === id));
  const type = useStore((s) => s.types.find((t) => t.id === entry?.typeId));
  const onClick = useContext(MentionClickContext);
  return (
    <NodeViewWrapper
      as="span"
      className={`mention ${entry ? "" : "mention-missing"}`}
      style={{ "--chip": type?.color ?? "var(--muted)" } as React.CSSProperties}
      onClick={() => entry && onClick(id)}
      title={entry ? entry.summary || entry.title : "This entry was deleted"}
    >
      {entry?.title ?? node.attrs.label ?? "missing"}
    </NodeViewWrapper>
  );
}

interface ListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<ListHandle, SuggestionProps<EntrySummary>>(({ items, command, query }, ref) => {
  const [index, setIndex] = useState(items.length ? 0 : -1);
  const types = useStore((s) => s.types);
  const name = query.trim();
  // Offer to create the entry when nothing matches the name exactly.
  const exact = items.some((e) => [e.title, ...e.aliases].some((n) => n.toLowerCase() === name.toLowerCase()));
  const looksLikeName = name.length > 0 && name.split(/\s+/).length <= 6;
  const creates = looksLikeName && !exact ? types : [];
  const total = items.length + creates.length;
  // With no matches nothing is pre-selected, so Enter still starts a new line.
  useEffect(() => setIndex(items.length ? 0 : -1), [items, name]);

  const pick = async (i: number) => {
    if (i < items.length) {
      const item = items[i];
      return command({ id: item.id, label: item.title } as never);
    }
    const type = creates[i - items.length];
    if (!type) return;
    const created = await createEntry(type.id, name, false);
    command({ id: created.id, label: created.title } as never);
    useStore.getState().notify(`Added ${created.title} to ${type.plural}`);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") return setIndex((i) => (i <= 0 ? total - 1 : i - 1)), true;
      if (event.key === "ArrowDown") return setIndex((i) => (i + 1) % Math.max(total, 1)), true;
      if ((event.key === "Enter" || event.key === "Tab") && index >= 0 && index < total) return pick(index), true;
      return false;
    },
  }));

  if (!total)
    return (
      <div className="menu mention-list">
        <p className="menu-note">Type a name to link an entry, or to create a new one.</p>
      </div>
    );
  return (
    <div className="menu mention-list">
      {items.map((item, i) => {
        const type = types.find((t) => t.id === item.typeId);
        return (
          <button
            key={item.id}
            className={i === index ? "active" : ""}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => (e.preventDefault(), pick(i))}
          >
            <span className="menu-icon">
              <EntryGlyph entry={item} size={13} />
            </span>
            <span>{item.title || "Untitled"}</span>
            <small>{type?.name}</small>
          </button>
        );
      })}
      {creates.length > 0 && (
        <>
          {items.length > 0 && <hr />}
          <p className="menu-label">Create “{name}” in…</p>
          {creates.map((t, j) => {
            const i = items.length + j;
            return (
              <button
                key={t.id}
                className={i === index ? "active" : ""}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => (e.preventDefault(), pick(i))}
              >
                <span className="menu-icon">
                  <TypeIcon name={t.icon} size={13} color={t.color} />
                </span>
                <span>{t.plural}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
});

function matchEntries(query: string): EntrySummary[] {
  const q = query.trim().toLowerCase();
  const entries = useStore.getState().entries;
  if (!q) return entries.slice(0, 8);
  const score = (e: EntrySummary) => {
    const names = [e.title, ...e.aliases].map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.includes(q))) return 1;
    return -1;
  };
  return entries
    .map((e) => [e, score(e)] as const)
    .filter(([, s]) => s >= 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 8)
    .map(([e]) => e);
}

const LoreMention = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip);
  },
}).configure({
  renderText: ({ node }) => node.attrs.label ?? "",
  suggestion: {
    char: "@",
    // Names have spaces: "@Captain Rhys".
    allowSpaces: true,
    items: ({ query }) => matchEntries(query),
    render: () => {
      let renderer: ReactRenderer<ListHandle, SuggestionProps<EntrySummary>> | null = null;
      const place = (props: SuggestionProps<EntrySummary>) => {
        const rect = props.clientRect?.();
        const el = renderer?.element as HTMLElement | undefined;
        if (!rect || !el) return;
        el.style.position = "fixed";
        el.style.zIndex = "50";
        el.style.left = `${rect.left}px`;
        const below = rect.bottom + 6;
        el.style.top = below + 260 > window.innerHeight ? `${rect.top - 266}px` : `${below}px`;
      };
      return {
        onStart: (props) => {
          renderer = new ReactRenderer(MentionList, { props, editor: props.editor });
          document.body.appendChild(renderer.element);
          place(props);
        },
        onUpdate: (props) => {
          renderer?.updateProps(props);
          place(props);
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") return renderer?.destroy(), renderer?.element.remove(), true;
          return renderer?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          renderer?.element.remove();
          renderer?.destroy();
          renderer = null;
        },
      };
    },
  },
});

export interface EditorStats {
  words: number;
  characters: number;
  /** Words in the current selection, or 0. */
  selectedWords: number;
}

interface Props {
  content: JSONContent | null;
  onChange: (doc: JSONContent, words: number, empty: boolean) => void;
  placeholder?: string;
  className?: string;
  autofocus?: boolean;
  /** Small inline editor for paragraph fields. */
  compact?: boolean;
  /** Long-form writing: typewriter scrolling and paragraph focus become available. */
  manuscript?: boolean;
  onStats?: (stats: EditorStats) => void;
}

const countWords = (text: string) => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Rich text with @mentions. Remount with a `key` to load a different document. */
export function RichEditor({ content, onChange, placeholder, className, autofocus, compact, manuscript, onStats }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const [find, setFind] = useState<{ term: string; replace: boolean } | null>(null);

  const report = (editor: Editor) => {
    if (!onStatsRef.current) return;
    const { from, to } = editor.state.selection;
    onStatsRef.current({
      words: editor.storage.characterCount.words(),
      characters: editor.storage.characterCount.characters(),
      selectedWords: from === to ? 0 : countWords(editor.state.doc.textBetween(from, to, " ", " ")),
    });
  };

  // Keep the line being written at a steady height, like a typewriter.
  const centerCaret = (editor: Editor) => {
    if (!manuscript || !getManuscriptLook().typewriter || !editor.isFocused) return;
    const scroller = (editor.view.dom as HTMLElement).closest(".manuscript, .content") as HTMLElement | null;
    if (!scroller) return;
    const caret = editor.view.coordsAtPos(editor.state.selection.head);
    const box = scroller.getBoundingClientRect();
    scroller.scrollTop += caret.top - (box.top + box.height * 0.45);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing… type @ to link an entry" }),
      CharacterCount,
      LoreMention,
      Spellcheck,
      ...(compact
        ? []
        : [
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            Highlight.configure({ multicolor: true }),
            TextStyle,
            Color,
            Subscript,
            Superscript,
            Typography,
            Search,
            CommentMark,
            Focus.configure({ className: "has-focus", mode: "shallowest" }),
          ]),
    ],
    editorProps: {
      // Eardloom's own spellchecker (which can learn words) replaces the browser's.
      attributes: { spellcheck: "false" },
      // Some writing apps copy formatted text only as RTF, which the
      // webview ignores. Read the RTF ourselves so italics etc. survive the paste.
      handlePaste: (view, event) => {
        const types = Array.from(event.clipboardData?.types ?? []);
        if (types.includes("text/html") || types.includes("Files")) return false;
        const plain = event.clipboardData?.getData("text/plain") ?? "";
        event.preventDefault();
        api
          .clipboardRtf()
          .then((rtf) => {
            const content = rtf ? rtfToContent(rtf) : [];
            if (!content.length) return void view.pasteText(plain);
            const doc = view.state.schema.nodeFromJSON({ type: "doc", content });
            // Open on both sides, so a one-paragraph paste flows into the current line.
            view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 1, 1)).scrollIntoView());
          })
          .catch(() => view.pasteText(plain));
        return true;
      },
    },
    content: content ?? undefined,
    autofocus: autofocus ? "end" : false,
    onCreate: ({ editor }) => {
      report(editor);
      if (manuscript) useActiveEditor.setState({ editor });
    },
    onDestroy: () => {
      if (manuscript) useActiveEditor.setState({ editor: null, focusedComment: null });
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getJSON(), editor.storage.characterCount.words(), editor.isEmpty);
      report(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      report(editor);
      centerCaret(editor);
    },
  });

  const spellMenu = async (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest(".spell-error") as HTMLElement | null;
    if (!el || !editor) return;
    e.preventDefault();
    e.stopPropagation();
    const word = el.dataset.word ?? el.textContent ?? "";
    const from = editor.view.posAtDOM(el, 0);
    const to = from + (el.textContent?.length ?? word.length);
    const { clientX: x, clientY: y } = e;
    const replace = (w: string) => editor.chain().focus().insertContentAt({ from, to }, w).run();
    const list = await suggestions(word);
    openMenuAt(x, y, [
      ...(list.length
        ? list.map((s) => ({ label: <strong>{s}</strong>, onClick: () => replace(s) }))
        : [{ label: "No suggestions", disabled: true, onClick: () => {} }]),
      "separator",
      { label: `Learn “${word}”`, onClick: () => useStore.getState().learnWord(word) },
      { label: "Ignore for now", onClick: () => ignoreWord(word) },
    ]);
  };

  const body = (
    <EditorContent
      editor={editor}
      className={`rich ${compact ? "compact" : ""} ${className ?? ""}`}
      onContextMenu={spellMenu}
      onClick={(e) => {
        const c = (e.target as HTMLElement).closest("[data-comment]") as HTMLElement | null;
        if (c && manuscript) useActiveEditor.setState({ focusedComment: c.dataset.comment ?? null });
      }}
    />
  );
  if (compact || !editor) return body;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "f" || e.key === "h")) {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      const selected = from !== to ? editor.state.doc.textBetween(from, to, " ").slice(0, 100) : "";
      setFind({ term: selected || find?.term || "", replace: e.key === "h" });
    }
  };

  return (
    <div className="rich-frame" onKeyDown={onKeyDown}>
      <FormatBar editor={editor} manuscript={manuscript} onFind={() => setFind({ term: "", replace: false })} />
      {find && <FindBar editor={editor} initial={find.term} withReplace={find.replace} onClose={() => setFind(null)} />}
      {body}
    </div>
  );
}
