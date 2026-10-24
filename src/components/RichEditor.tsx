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
import { RICH_BLOCKS } from "../lib/editor/blocks";
import { EntryMention, mentionText, nameVariants } from "../lib/editor/mention";
import { askText } from "./Prompt";
import { ignoreWord, suggestions } from "../lib/spell";
import { openMenuAt, type MenuItem } from "./ContextMenu";
import { ThesaurusPanel, topAlternatives } from "./Thesaurus";
import { lookup } from "../lib/thesaurus";
import { rtfToContent } from "../lib/editor/rtf";
import { Slice } from "@tiptap/pm/model";
import { api } from "../lib/api";
import { getManuscriptLook } from "../lib/prefs";
import type { EntrySummary } from "../lib/types";

/** Lets the surrounding view decide what clicking a mention does (navigate, open in side panel...). */
// Find in book shows its search in the chapter a result leads to.
let pendingFind: string | null = null;
/** Opens the find bar on `term` in the main manuscript editor that's open now. */
export function findInOpenEditor(term: string) {
  window.dispatchEvent(new CustomEvent("eardloom:find", { detail: term }));
}
/** Opens the find bar on `term` in the next main manuscript editor to open. */
export function findWhenOpened(term: string) {
  pendingFind = term;
}

export const MentionClickContext = createContext<(id: string) => void>(() => {});

function MentionChip({ node, updateAttributes, editor }: NodeViewProps) {
  const id = node.attrs.id as string;
  const entry = useStore((s) => s.entries.find((e) => e.id === id));
  const type = useStore((s) => s.types.find((t) => t.id === entry?.typeId));
  const onClick = useContext(MentionClickContext);
  const display = (node.attrs.display as string | null) || null;

  // Right-click: choose how this mention reads, without changing what it links to.
  const menu = (e: React.MouseEvent) => {
    if (!entry || !editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    const shown = mentionText(node.attrs, entry.title);
    openMenuAt(e.clientX, e.clientY, [
      { label: "Open entry", onClick: () => onClick(id) },
      "separator",
      ...nameVariants(entry).map((name) => ({
        label: name === shown ? <strong>{name}</strong> : name,
        onClick: () => updateAttributes({ display: name === entry.title ? null : name }),
      })),
      {
        label: "Other wording…",
        onClick: async () => {
          const text = await askText({
            title: "Show this mention as",
            label: `It still links to ${entry.title}.`,
            placeholder: "e.g. the Captain",
            initial: shown,
            confirm: "Use this",
          });
          if (text) updateAttributes({ display: text === entry.title ? null : text });
        },
      },
    ]);
  };

  return (
    <NodeViewWrapper
      as="span"
      className={`mention ${entry ? "" : "mention-missing"}`}
      style={{ "--chip": type?.color ?? "var(--muted)" } as React.CSSProperties}
      onClick={() => entry && onClick(id)}
      onContextMenu={menu}
      title={entry ? `${display ? `${entry.title}: ` : ""}${entry.summary || entry.title}\nRight-click to change how it reads` : "This entry was deleted"}
    >
      {entry ? mentionText(node.attrs, entry.title) : (display ?? node.attrs.label ?? "missing")}
    </NodeViewWrapper>
  );
}

/** One way of writing an entry's name, offered while typing @. */
interface NameMatch {
  entry: EntrySummary;
  text: string;
}

interface ListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<ListHandle, SuggestionProps<NameMatch>>(({ items, command, query }, ref) => {
  const [index, setIndex] = useState(items.length ? 0 : -1);
  const types = useStore((s) => s.types);
  const name = query.trim();
  // Offer to create the entry when nothing matches the name exactly.
  const exact = items.some(({ entry: e }) => [e.title, ...e.aliases].some((n) => n.toLowerCase() === name.toLowerCase()));
  const looksLikeName = name.length > 0 && name.split(/\s+/).length <= 6;
  const creates = looksLikeName && !exact ? types : [];
  const total = items.length + creates.length;
  // With no matches nothing is pre-selected, so Enter still starts a new line.
  useEffect(() => setIndex(items.length ? 0 : -1), [items, name]);

  const pick = async (i: number) => {
    if (i < items.length) {
      const { entry, text } = items[i];
      return command({ id: entry.id, label: entry.title, display: text === entry.title ? null : text } as never);
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
      {items.map(({ entry: item, text }, i) => {
        const type = types.find((t) => t.id === item.typeId);
        return (
          <button
            key={`${item.id}:${text}`}
            className={i === index ? "active" : ""}
            onMouseEnter={() => setIndex(i)}
            onMouseDown={(e) => (e.preventDefault(), pick(i))}
          >
            <span className="menu-icon">
              <EntryGlyph entry={item} size={13} />
            </span>
            <span>{text || "Untitled"}</span>
            <small>{text !== item.title ? item.title : type?.name}</small>
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

/**
 * Entries matching what's typed after @, offered by the name that matched: typing "@Aeth"
 * offers "Vex" as well as "Vex Arandel", so the text reads the way the author writes.
 */
function matchEntries(query: string): NameMatch[] {
  const q = query.trim().toLowerCase();
  const entries = useStore.getState().entries;
  if (!q) return entries.slice(0, 8).map((entry) => ({ entry, text: entry.title }));
  const out: (NameMatch & { score: number })[] = [];
  for (const entry of entries) {
    const variants = nameVariants(entry);
    const matched = variants
      .map((text) => ({ text, score: text.toLowerCase() === q ? 0 : text.toLowerCase().startsWith(q) ? 1 : text.toLowerCase().includes(q) ? 3 : -1 }))
      .filter((m) => m.score >= 0);
    if (!matched.length) continue;
    // The shortest matching name first ("Vex"), then the full title.
    matched.sort((a, b) => a.score - b.score || a.text.length - b.text.length);
    const best = matched[0];
    out.push({ entry, text: best.text, score: best.score });
    if (best.text !== entry.title) out.push({ entry, text: entry.title, score: best.score + 1 });
  }
  return out
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map(({ entry, text }) => ({ entry, text }));
}

const LoreMention = EntryMention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip);
  },
}).configure({
  renderText: ({ node }) => mentionText(node.attrs, useStore.getState().entries.find((e) => e.id === node.attrs.id)?.title),
  suggestion: {
    char: "@",
    // Names have spaces: "@Captain Rhys".
    allowSpaces: true,
    items: ({ query }) => matchEntries(query),
    render: () => {
      let renderer: ReactRenderer<ListHandle, SuggestionProps<NameMatch>> | null = null;
      const place = (props: SuggestionProps<NameMatch>) => {
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
  /** A second manuscript editor (side by side): it doesn't become the one comments and suggestions go to. */
  secondary?: boolean;
  /** Show the formatting toolbar (off when several editors share one). */
  toolbar?: boolean;
  onFocusEditor?: (editor: Editor) => void;
  onStats?: (stats: EditorStats) => void;
}

const countWords = (text: string) => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Rich text with @mentions. Remount with a `key` to load a different document. */
export function RichEditor({
  content,
  onChange,
  placeholder,
  className,
  autofocus,
  compact,
  manuscript,
  secondary,
  toolbar = true,
  onFocusEditor,
  onStats,
}: Props) {
  const primary = manuscript && !secondary;
  const onFocusRef = useRef(onFocusEditor);
  onFocusRef.current = onFocusEditor;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const [find, setFind] = useState<{ term: string; replace: boolean } | null>(null);
  const [thesaurus, setThesaurus] = useState<{ word: string; from: number; to: number; x: number; y: number } | null>(null);
  // Find in book opens its search in the chapter it leads to.
  useEffect(() => {
    if (!primary) return;
    if (pendingFind) (setFind({ term: pendingFind, replace: false }), (pendingFind = null));
    const on = (e: Event) => setFind({ term: (e as CustomEvent<string>).detail, replace: false });
    window.addEventListener("eardloom:find", on);
    return () => window.removeEventListener("eardloom:find", on);
  }, [primary]);

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
            ...RICH_BLOCKS,
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
      if (primary) useActiveEditor.setState({ editor });
    },
    onFocus: ({ editor }) => onFocusRef.current?.(editor),
    onDestroy: () => {
      if (primary) useActiveEditor.setState({ editor: null, focusedComment: null });
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

  /** The word at a position in the text (letters, apostrophes and hyphens), without a possessive 's. */
  const wordAt = (pos: number) => {
    if (!editor) return null;
    const $p = editor.state.doc.resolve(pos);
    const block = $p.parent;
    if (!block.isTextblock) return null;
    // Mentions, footnotes and other inline objects count as one character, like in the document.
    const text = block.textBetween(0, block.content.size, undefined, "\ufffc");
    const inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}'’-]/u.test(c);
    let s = $p.parentOffset;
    let e = s;
    while (s > 0 && inWord(text[s - 1])) s--;
    while (e < text.length && inWord(text[e])) e++;
    while (s < e && /['’-]/.test(text[s])) s++;
    while (e > s && /['’-]/.test(text[e - 1])) e--;
    if (/['’]s$/i.test(text.slice(s, e))) e -= 2;
    const word = text.slice(s, e);
    if (!/\p{L}/u.test(word)) return null;
    return { word, from: $p.start() + s, to: $p.start() + e };
  };

  /** The selected word, or the word under the pointer. */
  const wordFor = (x: number, y: number) => {
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      const picked = editor.state.doc.textBetween(from, to, " ", "\ufffc");
      if (/^[\p{L}'’-]+$/u.test(picked)) return { word: picked, from, to };
    }
    const hit = editor.view.posAtCoords({ left: x, top: y });
    return hit ? wordAt(hit.pos) : null;
  };

  /** Puts a word in place of another, keeping its formatting (italics and so on). */
  const replaceWord = (range: { from: number; to: number }, text: string) => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.insertText(text, range.from, range.to));
    editor.commands.focus();
  };

  const clipboardItems = (): MenuItem[] => {
    if (!editor) return [];
    const selected = !editor.state.selection.empty;
    return [
      { label: "Cut", shortcut: "Ctrl+X", disabled: !selected || !editor.isEditable, onClick: () => (editor.commands.focus(), document.execCommand("cut")) },
      { label: "Copy", shortcut: "Ctrl+C", disabled: !selected, onClick: () => (editor.commands.focus(), document.execCommand("copy")) },
      {
        label: "Paste",
        shortcut: "Ctrl+V",
        disabled: !editor.isEditable,
        onClick: async () => {
          editor.commands.focus();
          try {
            const [item] = await navigator.clipboard.read();
            if (item?.types.includes("text/html")) return editor.view.pasteHTML(await (await item.getType("text/html")).text());
          } catch {
            /* fall back to plain text */
          }
          editor.view.pasteText(await navigator.clipboard.readText());
        },
      },
    ];
  };

  // Right-click: spelling suggestions on a misspelt word; otherwise alternatives from the thesaurus.
  const contextMenu = async (e: React.MouseEvent) => {
    if (!editor || (e.target as HTMLElement).closest(".spell-error")) return spellMenu(e);
    e.preventDefault();
    const { clientX: x, clientY: y } = e;
    const range = wordFor(x, y);
    const items: MenuItem[] = [];
    if (range) {
      const alternatives = topAlternatives(range.word, await lookup(range.word).catch(() => []));
      items.push(
        ...(alternatives.length
          ? alternatives.map((a) => ({
              label: (
                <span className="menu-alt">
                  <strong>{a.text}</strong>
                  <small>{a.gloss}</small>
                </span>
              ),
              onClick: () => replaceWord(range, a.text),
            }))
          : [{ label: `No alternatives for “${range.word}”`, disabled: true, onClick: () => {} }]),
        { label: "Thesaurus…", shortcut: "Shift+F7", onClick: () => setThesaurus({ ...range, x, y }) },
        "separator",
      );
    }
    openMenuAt(x, y, [...items, ...clipboardItems()]);
  };

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
      "separator",
      ...clipboardItems(),
    ]);
  };

  const body = (
    <EditorContent
      editor={editor}
      className={`rich ${compact ? "compact" : ""} ${className ?? ""}`}
      onContextMenu={contextMenu}
      onClick={(e) => {
        const c = (e.target as HTMLElement).closest("[data-comment]") as HTMLElement | null;
        if (c && primary) useActiveEditor.setState({ focusedComment: c.dataset.comment ?? null });
      }}
    />
  );
  if (compact || !editor) return body;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.shiftKey && e.key === "F7") {
      e.preventDefault();
      const { from } = editor.state.selection;
      const range = editor.state.selection.empty ? wordAt(from) : wordFor(-1, -1);
      const at = editor.view.coordsAtPos(from);
      if (range) setThesaurus({ ...range, x: at.left, y: at.bottom });
      return;
    }
    if (mod && (e.key === "f" || e.key === "h")) {
      e.preventDefault();
      const { from, to } = editor.state.selection;
      const selected = from !== to ? editor.state.doc.textBetween(from, to, " ").slice(0, 100) : "";
      setFind({ term: selected || find?.term || "", replace: e.key === "h" });
    }
  };

  return (
    <div className="rich-frame" onKeyDown={onKeyDown}>
      {toolbar && <FormatBar editor={editor} manuscript={manuscript} onFind={() => setFind({ term: "", replace: false })} />}
      {find && <FindBar key={find.term} editor={editor} initial={find.term} withReplace={find.replace} onClose={() => setFind(null)} />}
      {body}
      {thesaurus && (
        <ThesaurusPanel
          word={thesaurus.word}
          at={thesaurus}
          onUse={(text) => (replaceWord(thesaurus, text), setThesaurus(null))}
          onClose={() => setThesaurus(null)}
        />
      )}
    </div>
  );
}
