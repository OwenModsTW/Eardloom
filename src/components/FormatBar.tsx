import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold, Italic, List, ListOrdered, Minus, Quote, Redo2, Strikethrough, Underline, Undo2,
} from "lucide-react";
import { Select } from "./Select";

type Style = "p" | "h1" | "h2" | "h3";

const STYLES: { value: Style; label: string }[] = [
  { value: "p", label: "Body text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

/** Formatting controls for a rich text editor. Sticks to the top while scrolling. */
export function FormatBar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: (e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p") as Style,
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const setStyle = (v: Style) =>
    v === "p" ? chain().setParagraph().run() : chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();

  const btn = (on: boolean, label: string, run: () => void, icon: React.ReactNode, disabled = false) => (
    <button
      type="button"
      className={on ? "on" : ""}
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      // Keep the text selection while clicking.
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon}
    </button>
  );

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <Select className="bare format-style" value={s.style} onChange={setStyle} options={STYLES} />
      <span className="format-sep" />
      {btn(s.bold, "Bold (Ctrl+B)", () => chain().toggleBold().run(), <Bold size={15} />)}
      {btn(s.italic, "Italic (Ctrl+I)", () => chain().toggleItalic().run(), <Italic size={15} />)}
      {btn(s.underline, "Underline (Ctrl+U)", () => chain().toggleUnderline().run(), <Underline size={15} />)}
      {btn(s.strike, "Strikethrough (Ctrl+Shift+S)", () => chain().toggleStrike().run(), <Strikethrough size={15} />)}
      <span className="format-sep" />
      {btn(s.bullet, "Bulleted list (Ctrl+Shift+8)", () => chain().toggleBulletList().run(), <List size={15} />)}
      {btn(s.ordered, "Numbered list (Ctrl+Shift+7)", () => chain().toggleOrderedList().run(), <ListOrdered size={15} />)}
      {btn(s.quote, "Quote (Ctrl+Shift+B)", () => chain().toggleBlockquote().run(), <Quote size={15} />)}
      {btn(false, "Scene break", () => chain().setHorizontalRule().run(), <Minus size={15} />)}
      <span className="spacer" />
      {btn(false, "Undo (Ctrl+Z)", () => chain().undo().run(), <Undo2 size={15} />, !s.canUndo)}
      {btn(false, "Redo (Ctrl+Y)", () => chain().redo().run(), <Redo2 size={15} />, !s.canRedo)}
    </div>
  );
}
