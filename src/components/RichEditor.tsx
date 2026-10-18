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

const MentionList = forwardRef<ListHandle, SuggestionProps<EntrySummary>>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0);
  const types = useStore((s) => s.types);
  useEffect(() => setIndex(0), [items]);

  const pick = (i: number) => {
    const item = items[i];
    if (item) command({ id: item.id, label: item.title } as never);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") return setIndex((i) => (i + items.length - 1) % Math.max(items.length, 1)), true;
      if (event.key === "ArrowDown") return setIndex((i) => (i + 1) % Math.max(items.length, 1)), true;
      if (event.key === "Enter" || event.key === "Tab") return pick(index), true;
      return false;
    },
  }));

  if (!items.length) return <div className="menu mention-list"><p className="menu-note">No matching entries. Create it first, or press Ctrl+K.</p></div>;
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

  return <EditorContent editor={editor} className={`rich ${compact ? "compact" : ""} ${className ?? ""}`} />;
}
