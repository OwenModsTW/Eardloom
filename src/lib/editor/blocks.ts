// Images, tables and footnotes for chapters and entry articles. Shared by every editor that
// loads documents, so none of them drops content it doesn't know.
import { mergeAttributes, Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Plugin } from "@tiptap/pm/state";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../../store";

/** Where a world image file is shown from. */
export function assetSrc(name: string) {
  const base = useStore.getState().world?.assetsPath;
  return base ? convertFileSrc(`${base}/${name}`) : "";
}

/** An image kept in the world's assets folder (so it travels with backups and shared worlds). */
export const WorldImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      asset: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-asset"),
        renderHTML: (a: { asset?: string | null }) => (a.asset ? { "data-asset": a.asset } : {}),
      },
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("src"),
        renderHTML: (a: { src?: string | null; asset?: string | null }) => ({ src: a.asset ? assetSrc(a.asset) : a.src }),
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

export const Tables = TableKit.configure({ table: { resizable: false } });

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      /** Adds a footnote with this text at the cursor. */
      insertFootnote: (text: string) => ReturnType;
    };
  }
}

/** Called when a footnote marker is clicked, to edit its text. */
let editFootnote: ((text: string) => Promise<string | null>) | null = null;
export function onEditFootnote(fn: (text: string) => Promise<string | null>) {
  editFootnote = fn;
}

/** A footnote: a numbered marker in the text, with the note kept on the marker. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: { default: "", parseHTML: (el) => el.getAttribute("data-footnote") ?? "", renderHTML: (a) => ({ "data-footnote": a.text, title: a.text }) },
    };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "footnote" })];
  },
  renderText() {
    return "";
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Alt-f": () => {
        if (!editFootnote) return false;
        const editor = this.editor;
        editFootnote("").then((text) => text && editor.chain().focus().insertFootnote(text).run());
        return true;
      },
    };
  },
  addCommands() {
    return {
      insertFootnote:
        (text) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { text } }),
    };
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        props: {
          handleClickOn: (view, _pos, node, nodePos) => {
            if (node.type !== type || !editFootnote || !view.editable) return false;
            editFootnote(node.attrs.text).then((text) => {
              if (text === null) return;
              const current = view.state.doc.nodeAt(nodePos);
              if (current?.type !== type) return;
              view.dispatch(
                text.trim()
                  ? view.state.tr.setNodeMarkup(nodePos, undefined, { text })
                  : view.state.tr.delete(nodePos, nodePos + current.nodeSize),
              );
            });
            return true;
          },
        },
      }),
    ];
  },
});

export const RICH_BLOCKS = [WorldImage, Tables, Footnote];
