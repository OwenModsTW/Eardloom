import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Baseline, Bold, Highlighter, IndentDecrease, IndentIncrease,
  Italic, Link2, List, ListOrdered, MessageSquarePlus, Minus, MoreHorizontal, Quote, Redo2, RemoveFormatting, Search, Strikethrough,
  Subscript, Superscript, Type, Underline, Undo2, Plus, ImagePlus, Table2, Asterisk,
} from "lucide-react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { api } from "../lib/api";
import { askText } from "./Prompt";
import { Select } from "./Select";
import { openMenu } from "./ContextMenu";
import { FONTS, getManuscriptLook, setManuscriptLook, type ManuscriptLook } from "../lib/prefs";

type Style = "p" | "h1" | "h2" | "h3";

const STYLES: { value: Style; label: string }[] = [
  { value: "p", label: "Body text" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

/** Semi-transparent so they read on both the dark and light themes. */
export const HIGHLIGHTS = [
  { name: "Yellow", color: "#f2c94c66" },
  { name: "Green", color: "#6fcf9766" },
  { name: "Blue", color: "#56ccf266" },
  { name: "Pink", color: "#eb579766" },
  { name: "Orange", color: "#f2994a66" },
];

export const TEXT_COLORS = [
  { name: "Gold", color: "#d9a53f" },
  { name: "Red", color: "#d9645a" },
  { name: "Blue", color: "#4f9fc4" },
  { name: "Green", color: "#4e9f73" },
  { name: "Purple", color: "#9a7fd6" },
  { name: "Grey", color: "#8b9496" },
];

/** A small anchored panel that closes on outside click or Escape. */
function Popover({ anchor, onClose, children }: { anchor: DOMRect; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => (window.removeEventListener("mousedown", down), window.removeEventListener("keydown", key));
  }, [onClose]);
  return (
    <div ref={ref} className="menu format-pop" style={{ left: Math.min(anchor.left, window.innerWidth - 300), top: anchor.bottom + 4 }}>
      {children}
    </div>
  );
}

function Swatches({ colors, onPick, onClear }: { colors: { name: string; color: string }[]; onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div className="swatch-row">
      {colors.map((c) => (
        <button key={c.color} className="swatch-btn" title={c.name} style={{ background: c.color }} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c.color)} />
      ))}
      <button className="link quiet" onMouseDown={(e) => e.preventDefault()} onClick={onClear}>
        None
      </button>
    </div>
  );
}

function LinkForm({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const current = editor.getAttributes("link").href as string | undefined;
  const [url, setUrl] = useState(current ?? "");
  const apply = () => {
    const href = url.trim();
    if (!href) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(href) ? href : `https://${href}` }).run();
    onDone();
  };
  return (
    <form className="link-form" onSubmit={(e) => (e.preventDefault(), apply())}>
      <input autoFocus value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      <button className="primary" type="submit">
        {current ? "Update" : "Add link"}
      </button>
      {current && (
        <button className="ghost" type="button" onClick={() => (editor.chain().focus().extendMarkRange("link").unsetLink().run(), onDone())}>
          Remove
        </button>
      )}
    </form>
  );
}

function LookPanel() {
  const [look, setLook] = useState<ManuscriptLook>(getManuscriptLook);
  const set = (patch: Partial<ManuscriptLook>) => setLook(setManuscriptLook(patch));
  const stepper = (label: string, value: string, dec: () => void, inc: () => void) => (
    <div className="look-row">
      <span>{label}</span>
      <div className="stepper">
        <button onClick={dec}>−</button>
        <span>{value}</span>
        <button onClick={inc}>+</button>
      </div>
    </div>
  );
  return (
    <div className="look-panel">
      <div className="look-row">
        <span>Font</span>
        <Select
          value={look.font}
          onChange={(font) => set({ font })}
          options={(Object.keys(FONTS) as ManuscriptLook["font"][]).map((f) => ({ value: f, label: <span style={{ fontFamily: FONTS[f].css }}>{FONTS[f].label}</span> }))}
        />
      </div>
      {stepper("Size", `${look.size}px`, () => set({ size: Math.max(12, look.size - 1) }), () => set({ size: Math.min(32, look.size + 1) }))}
      {stepper("Line spacing", look.lineHeight.toFixed(1), () => set({ lineHeight: Math.max(1.2, +(look.lineHeight - 0.1).toFixed(1)) }), () => set({ lineHeight: Math.min(2.6, +(look.lineHeight + 0.1).toFixed(1)) }))}
      {stepper("Page width", `${look.width}px`, () => set({ width: Math.max(480, look.width - 40) }), () => set({ width: Math.min(1200, look.width + 40) }))}
      <label className="check">
        <input type="checkbox" checked={look.pageView} onChange={(e) => set({ pageView: e.target.checked })} />
        <span>Page view: write on paper, with page breaks marked</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={look.indent} onChange={(e) => set({ indent: e.target.checked })} />
        <span>Indent paragraphs like a printed novel</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={look.typewriter} onChange={(e) => set({ typewriter: e.target.checked })} />
        <span>Typewriter scrolling</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={look.dimOthers} onChange={(e) => set({ dimOthers: e.target.checked })} />
        <span>Fade all but the current paragraph</span>
      </label>
      <p className="hint">Only changes how it looks while you write. Exports use their own layout.</p>
    </div>
  );
}

/** Formatting controls for a rich text editor. Sticks to the top while scrolling. */
export function FormatBar({ editor, manuscript, onFind }: { editor: Editor; manuscript?: boolean; onFind: () => void }) {
  const [pop, setPop] = useState<{ kind: "highlight" | "color" | "link" | "look"; anchor: DOMRect } | null>(null);
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
      sub: e.isActive("subscript"),
      sup: e.isActive("superscript"),
      link: e.isActive("link"),
      highlight: e.isActive("highlight"),
      align: (["center", "right", "justify"].find((a) => e.isActive({ textAlign: a })) ?? "left") as string,
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      inList: e.isActive("listItem"),
      quote: e.isActive("blockquote"),
      inTable: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const setStyle = (v: Style) =>
    v === "p" ? chain().setParagraph().run() : chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  const open = (kind: NonNullable<typeof pop>["kind"]) => (e: React.MouseEvent) =>
    setPop({ kind, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() });

  const btn = (on: boolean, label: string, run: (e: React.MouseEvent) => void, icon: ReactNode, disabled = false) => (
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

  const insertImage = async () => {
    const file = await openFile({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof file !== "string") return;
    const asset = await api.importAsset(file);
    chain().insertContent({ type: "image", attrs: { asset, alt: "" } }).run();
  };
  const insertFootnote = async () => {
    const text = await askText({ title: "Footnote", placeholder: "The note's text", confirm: "Add footnote" });
    if (text) chain().insertFootnote(text).run();
  };
  const tableMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: "Add row above", onClick: () => chain().addRowBefore().run() },
      { label: "Add row below", onClick: () => chain().addRowAfter().run() },
      { label: "Add column left", onClick: () => chain().addColumnBefore().run() },
      { label: "Add column right", onClick: () => chain().addColumnAfter().run() },
      "separator",
      { label: "Header row on/off", onClick: () => chain().toggleHeaderRow().run() },
      { label: "Merge or split cells", onClick: () => chain().mergeOrSplit().run() },
      "separator",
      { label: "Delete row", danger: true, onClick: () => chain().deleteRow().run() },
      { label: "Delete column", danger: true, onClick: () => chain().deleteColumn().run() },
      { label: "Delete table", danger: true, onClick: () => chain().deleteTable().run() },
    ]);

  const alignIcon = { left: <AlignLeft size={15} />, center: <AlignCenter size={15} />, right: <AlignRight size={15} />, justify: <AlignJustify size={15} /> }[s.align];

  return (
    <div className="format-bar" role="toolbar" aria-label="Formatting">
      <Select className="bare format-style" value={s.style} onChange={setStyle} options={STYLES} />
      <span className="format-sep" />
      {btn(s.bold, "Bold (Ctrl+B)", () => chain().toggleBold().run(), <Bold size={15} />)}
      {btn(s.italic, "Italic (Ctrl+I)", () => chain().toggleItalic().run(), <Italic size={15} />)}
      {btn(s.underline, "Underline (Ctrl+U)", () => chain().toggleUnderline().run(), <Underline size={15} />)}
      {btn(s.strike, "Strikethrough (Ctrl+Shift+S)", () => chain().toggleStrike().run(), <Strikethrough size={15} />)}
      {btn(s.highlight, "Highlight", open("highlight"), <Highlighter size={15} />)}
      {btn(false, "Text colour", open("color"), <Baseline size={15} />)}
      {btn(s.link, "Link", open("link"), <Link2 size={15} />)}
      <span className="format-sep" />
      {btn(
        s.align !== "left",
        "Alignment",
        (e) =>
          openMenu(e, [
            { label: "Align left", icon: <AlignLeft size={14} />, shortcut: "Ctrl Shift L", onClick: () => chain().setTextAlign("left").run() },
            { label: "Centre", icon: <AlignCenter size={14} />, shortcut: "Ctrl Shift E", onClick: () => chain().setTextAlign("center").run() },
            { label: "Align right", icon: <AlignRight size={14} />, shortcut: "Ctrl Shift R", onClick: () => chain().setTextAlign("right").run() },
            { label: "Justify", icon: <AlignJustify size={14} />, shortcut: "Ctrl Shift J", onClick: () => chain().setTextAlign("justify").run() },
          ]),
        alignIcon,
      )}
      {btn(s.bullet, "Bulleted list (Ctrl+Shift+8)", () => chain().toggleBulletList().run(), <List size={15} />)}
      {btn(s.ordered, "Numbered list (Ctrl+Shift+7)", () => chain().toggleOrderedList().run(), <ListOrdered size={15} />)}
      {s.inList && btn(false, "Indent list item (Tab)", () => chain().sinkListItem("listItem").run(), <IndentIncrease size={15} />)}
      {s.inList && btn(false, "Outdent list item (Shift+Tab)", () => chain().liftListItem("listItem").run(), <IndentDecrease size={15} />)}
      {btn(s.quote, "Quote (Ctrl+Shift+B)", () => chain().toggleBlockquote().run(), <Quote size={15} />)}
      {btn(false, "Scene break", () => chain().setHorizontalRule().run(), <Minus size={15} />)}
      {btn(
        false,
        "Insert",
        (e) =>
          openMenu(e, [
            { label: "Image…", icon: <ImagePlus size={14} />, onClick: insertImage },
            { label: "Table", icon: <Table2 size={14} />, onClick: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
            { label: "Footnote…", icon: <Asterisk size={14} />, shortcut: "Ctrl Alt F", onClick: insertFootnote },
          ]),
        <Plus size={15} />,
      )}
      {s.inTable && btn(true, "Table", tableMenu, <Table2 size={15} />)}
      {btn(
        s.sub || s.sup,
        "More",
        (e) =>
          openMenu(e, [
            { label: "Superscript", icon: <Superscript size={14} />, shortcut: "Ctrl .", onClick: () => chain().toggleSuperscript().run() },
            { label: "Subscript", icon: <Subscript size={14} />, shortcut: "Ctrl ,", onClick: () => chain().toggleSubscript().run() },
            "separator",
            { label: "Clear formatting", icon: <RemoveFormatting size={14} />, onClick: () => chain().unsetAllMarks().clearNodes().run() },
          ]),
        <MoreHorizontal size={15} />,
      )}
      <span className="spacer" />
      {manuscript && btn(false, "Comment on selection (Ctrl+Alt+M)", () => window.dispatchEvent(new CustomEvent("eardloom:comment")), <MessageSquarePlus size={15} />)}
      {btn(false, "Find and replace (Ctrl+F)", onFind, <Search size={15} />)}
      {manuscript && btn(false, "Page appearance", open("look"), <Type size={15} />)}
      {btn(false, "Undo (Ctrl+Z)", () => chain().undo().run(), <Undo2 size={15} />, !s.canUndo)}
      {btn(false, "Redo (Ctrl+Y)", () => chain().redo().run(), <Redo2 size={15} />, !s.canRedo)}

      {pop && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)}>
          {pop.kind === "highlight" && (
            <Swatches
              colors={HIGHLIGHTS}
              onPick={(color) => (chain().setHighlight({ color }).run(), setPop(null))}
              onClear={() => (chain().unsetHighlight().run(), setPop(null))}
            />
          )}
          {pop.kind === "color" && (
            <Swatches
              colors={TEXT_COLORS}
              onPick={(color) => (chain().setColor(color).run(), setPop(null))}
              onClear={() => (chain().unsetColor().run(), setPop(null))}
            />
          )}
          {pop.kind === "link" && <LinkForm editor={editor} onDone={() => setPop(null)} />}
          {pop.kind === "look" && <LookPanel />}
        </Popover>
      )}
    </div>
  );
}
