// Turning chapters and articles into PDF (pdfmake), shared by entry sharing, world guides and
// print-ready books. The layout engine and fonts load only when a PDF is made.

import type { JSONContent } from "@tiptap/react";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { useStore } from "../../store";
import { mentionText } from "../editor/mention";
import type { LoadedImage } from "./images";

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const dataUrl = (img: LoadedImage) => `data:${img.mime};base64,${toBase64(img.bytes)}`;

/** How body text is set. Articles use spaced paragraphs; books use indents, like print. */
export interface PdfText {
  /** First-line indent in points (0 for spaced paragraphs). */
  indent: number;
  /** Space after each paragraph, in points. */
  gap: number;
  /** No indent on the first paragraph of a chapter or after a heading or scene break. */
  flushFirst: boolean;
  alignment?: "left" | "justify";
  sceneBreak: string;
  /** Widest an image may be, in points. */
  imageWidth: number;
}

export const ARTICLE_TEXT: PdfText = { indent: 0, gap: 6, flushFirst: false, sceneBreak: "*   *   *", imageWidth: 440 };

export interface PdfContext {
  images: Map<string, LoadedImage>;
  /** Footnotes met so far, numbered from 1 (collected for the end of the chapter or entry). */
  notes: string[];
  text: PdfText;
  /** The next paragraph starts a section (set at chapter starts, headings and scene breaks). */
  fresh: boolean;
}

export const pdfContext = (images: Map<string, LoadedImage>, text: PdfText = ARTICLE_TEXT): PdfContext => ({ images, notes: [], text, fresh: true });

export function pdfInline(nodes: JSONContent[] | undefined, ctx: PdfContext): Content[] {
  const entries = useStore.getState().entries;
  return (nodes ?? []).map((n): Content => {
    if (n.type === "hardBreak") return { text: "\n" };
    if (n.type === "mention") return { text: mentionText(n.attrs, entries.find((e) => e.id === n.attrs?.id)?.title) };
    if (n.type === "footnote") {
      ctx.notes.push(String(n.attrs?.text ?? ""));
      return { text: String(ctx.notes.length), sup: true };
    }
    const marks = new Set((n.marks ?? []).map((m) => m.type));
    const href = n.marks?.find((m) => m.type === "link")?.attrs?.href;
    return {
      text: n.text ?? "",
      bold: marks.has("bold") || undefined,
      italics: marks.has("italic") || undefined,
      decoration: marks.has("underline") ? "underline" : marks.has("strike") ? "lineThrough" : undefined,
      sup: marks.has("superscript") || undefined,
      sub: marks.has("subscript") || undefined,
      ...(typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? { link: href, color: "#1f6fb2" } : {}),
    };
  });
}

export function pdfBlocks(n: JSONContent, ctx: PdfContext): Content[] {
  const kids = () => (n.content ?? []).flatMap((c) => pdfBlocks(c, ctx));
  const set = ctx.text;
  const align = ["center", "right", "justify"].includes(n.attrs?.textAlign) ? n.attrs!.textAlign : undefined;
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph": {
      const flush = set.flushFirst && ctx.fresh;
      ctx.fresh = false;
      return [{ text: pdfInline(n.content, ctx), margin: [0, 0, 0, set.gap], alignment: align ?? set.alignment, leadingIndent: flush || align === "center" ? 0 : set.indent }];
    }
    case "heading":
      ctx.fresh = true;
      return [{ text: pdfInline(n.content, ctx), style: `h${Math.min(3, n.attrs?.level ?? 1)}`, alignment: align }];
    case "blockquote":
      return [{ stack: kids(), italics: true, margin: [18, 4, 0, 6], color: "#444444" }];
    case "bulletList":
      return [{ ul: (n.content ?? []).map((li) => ({ stack: pdfBlocks({ type: "doc", content: li.content }, { ...ctx, text: ARTICLE_TEXT }) })), margin: [0, 0, 0, 6] }];
    case "orderedList":
      return [{ ol: (n.content ?? []).map((li) => ({ stack: pdfBlocks({ type: "doc", content: li.content }, { ...ctx, text: ARTICLE_TEXT }) })), margin: [0, 0, 0, 6] }];
    case "codeBlock":
      return [{ text: (n.content ?? []).map((c) => c.text ?? "").join(""), margin: [0, 0, 0, 6], color: "#333333" }];
    case "horizontalRule":
      ctx.fresh = true;
      return [{ text: set.sceneBreak, alignment: "center", margin: [0, 8, 0, 8] }];
    case "image": {
      const img = typeof n.attrs?.asset === "string" ? ctx.images.get(n.attrs.asset) : undefined;
      return img ? [{ image: dataUrl(img), fit: [set.imageWidth, set.imageWidth * 0.8], alignment: "center", margin: [0, 6, 0, 10] }] : [];
    }
    case "table": {
      const cell = (c: JSONContent) => ({ stack: pdfBlocks({ type: "doc", content: c.content }, { ...ctx, text: ARTICLE_TEXT }), bold: c.type === "tableHeader" });
      const rows = (n.content ?? []).map((r) => (r.content ?? []).map(cell));
      const width = Math.max(1, ...rows.map((r) => r.length));
      const body = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
      return body.length ? [{ table: { headerRows: n.content?.[0]?.content?.every((c) => c.type === "tableHeader") ? 1 : 0, widths: Array(width).fill("*"), body }, layout: "lightHorizontalLines", margin: [0, 4, 0, 10] }] : [];
    }
    default:
      return n.content ? kids() : [];
  }
}

export const PDF_STYLES: TDocumentDefinitions["styles"] = {
  kind: { fontSize: 9, bold: true, characterSpacing: 1 },
  title: { fontSize: 24, bold: true, margin: [0, 2, 0, 6] },
  h1: { fontSize: 16, bold: true, margin: [0, 10, 0, 4] },
  h2: { fontSize: 14, bold: true, margin: [0, 8, 0, 4] },
  h3: { fontSize: 12, bold: true, margin: [0, 6, 0, 3] },
  part: { fontSize: 28, bold: true, alignment: "center", margin: [0, 200, 0, 10] },
  cover: { fontSize: 34, bold: true, alignment: "center", margin: [0, 220, 0, 10] },
};

/** Typefaces bundled for books (SIL Open Font License): a book face and a manuscript Courier. */
const BOOK_FONTS = {
  Crimson: { normal: "CrimsonText-Regular.ttf", bold: "CrimsonText-Bold.ttf", italics: "CrimsonText-Italic.ttf", bolditalics: "CrimsonText-BoldItalic.ttf" },
  CourierPrime: { normal: "CourierPrime-Regular.ttf", bold: "CourierPrime-Bold.ttf", italics: "CourierPrime-Italic.ttf", bolditalics: "CourierPrime-BoldItalic.ttf" },
};
export type BookFont = keyof typeof BOOK_FONTS;

/** Where the bundled font files are read from (replaceable for tests). */
export let readFont = async (file: string) => new Uint8Array(await (await fetch(`/fonts/${file}`)).arrayBuffer());
export const setFontReader = (fn: typeof readFont) => (readFont = fn);

/** Makes a PDF. Pass `fonts` to use the bundled book typefaces. */
export async function makePdf(def: TDocumentDefinitions, fonts: BookFont[] = []): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts")]);
  pdfMake.addVirtualFileSystem(vfs);
  if (fonts.length) {
    const files: Record<string, string> = {};
    for (const f of fonts) for (const file of Object.values(BOOK_FONTS[f])) files[file] = toBase64(await readFont(file));
    pdfMake.addVirtualFileSystem(files);
    pdfMake.addFonts(Object.fromEntries(fonts.map((f) => [f, BOOK_FONTS[f]])));
  }
  const blob = await pdfMake.createPdf({ pageSize: "A4", pageMargins: [56, 56, 56, 64], defaultStyle: { fontSize: 11, lineHeight: 1.3 }, styles: PDF_STYLES, ...def }).getBlob();
  return new Uint8Array(await blob.arrayBuffer());
}
