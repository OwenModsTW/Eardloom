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
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { useStore } from "../store";
import { EntryGlyph } from "./EntryIcon";
import { TypeIcon } from "../lib/icons";
import { createEntry } from "../lib/actions";
import { FormatBar } from "./FormatBar";
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

interface Props {
  content: JSONContent | null;
  onChange: (doc: JSONContent, words: number, empty: boolean) => void;
  placeholder?: string;
  className?: string;
  autofocus?: boolean;
  /** Small inline editor for paragraph fields. */
  compact?: boolean;
}

/** Rich text with @mentions. Remount with a `key` to load a different document. */
export function RichEditor({ content, onChange, placeholder, className, autofocus, compact }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing… type @ to link an entry" }),
      CharacterCount,
      LoreMention,
    ],
    content: content ?? undefined,
    autofocus: autofocus ? "end" : false,
    onUpdate: ({ editor }) =>
      onChangeRef.current(editor.getJSON(), editor.storage.characterCount.words(), editor.isEmpty),
  });

  const body = <EditorContent editor={editor} className={`rich ${compact ? "compact" : ""} ${className ?? ""}`} />;
  if (compact || !editor) return body;
  return (
    <div className="rich-frame">
      <FormatBar editor={editor} />
      {body}
    </div>
  );
}
