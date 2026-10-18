import JSZip from "jszip";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  ShadingType,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from "docx";
import type { JSONContent } from "@tiptap/react";
import { api } from "../api";
import { docToHtml, esc } from "./html";
import { useStore } from "../../store";
import type { DocSummary } from "../types";

export type BookFormat = "epub" | "docx" | "md";

export interface BookOptions {
  title: string;
  author: string;
  format: BookFormat;
  /** Ordered ids of the binder items to include (folders and documents). */
  include: string[];
  /** Readers don't need the codex: render @mentions as the plain name. */
  plainLinks: boolean;
  /** Folders become part headings ("Part One"); otherwise they're skipped. */
  folderHeadings: boolean;
  /** Each document's title becomes its chapter heading. */
  chapterTitles: boolean;
}

interface Section {
  kind: "part" | "chapter";
  title: string;
  body: JSONContent | null;
}

/** Binder items in reading order: depth-first, siblings by sort. */
export function readingOrder(docs: DocSummary[]): DocSummary[] {
  const out: DocSummary[] = [];
  const visit = (parentId: string | null) =>
    docs
      .filter((d) => d.parentId === parentId)
      .sort((a, b) => a.sort - b.sort)
      .forEach((d) => {
        out.push(d);
        visit(d.id);
      });
  visit(null);
  return out;
}

async function gather(projectId: string, opts: BookOptions): Promise<Section[]> {
  const docs = readingOrder(await api.listDocs(projectId)).filter((d) => opts.include.includes(d.id));
  const sections: Section[] = [];
  for (const d of docs) {
    if (d.kind === "folder") {
      if (opts.folderHeadings) sections.push({ kind: "part", title: d.title, body: null });
    } else {
      sections.push({ kind: "chapter", title: d.title, body: (await api.getDoc(d.id)).body });
    }
  }
  return sections;
}

const mentionName = (node: JSONContent) =>
  useStore.getState().entries.find((e) => e.id === node.attrs?.id)?.title || node.attrs?.label || "";

// ---------------------------------------------------------------- HTML (EPUB)

const blockHtml = (n: JSONContent, opts: BookOptions) =>
  docToHtml(n, {
    // Chapter titles are h1/h2, so headings inside a chapter start at h3.
    headingOffset: 2,
    mention: (m) => (opts.plainLinks ? esc(mentionName(m)) : `<span class="entry">${esc(mentionName(m))}</span>`),
  });

const EPUB_CSS = `
body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2 { text-align: center; font-weight: normal; margin: 3em 0 1.5em; page-break-before: always; }
h1.part { margin-top: 30%; font-size: 1.8em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
h1 + p, h2 + p, h3 + p, hr + p, blockquote + p { text-indent: 0; }
hr { border: 0; text-align: center; margin: 1.5em 0; }
hr::after { content: "* * *"; }
blockquote { margin: 1em 2em; font-style: italic; }
.entry { font-variant: small-caps; }
.title-page { text-align: center; margin-top: 30%; }
.title-page h1 { page-break-before: auto; font-size: 2.2em; margin: 0 0 1em; }
.title-page p { text-indent: 0; text-align: center; font-size: 1.2em; }
`;

const xhtml = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;

async function toEpub(sections: Section[], opts: BookOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  // The mimetype entry must come first and be stored uncompressed.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const files = sections.map((s, i) => ({ ...s, file: `s${String(i + 1).padStart(3, "0")}.xhtml` }));
  zip.file("OEBPS/style.css", EPUB_CSS);
  zip.file(
    "OEBPS/title.xhtml",
    xhtml(opts.title, `<section class="title-page"><h1>${esc(opts.title)}</h1>${opts.author ? `<p>${esc(opts.author)}</p>` : ""}</section>`),
  );
  for (const f of files) {
    const heading =
      f.kind === "part" ? `<h1 class="part">${esc(f.title)}</h1>` : opts.chapterTitles ? `<h2>${esc(f.title)}</h2>` : "";
    zip.file(`OEBPS/${f.file}`, xhtml(f.title, heading + (f.body ? blockHtml(f.body, opts) : "")));
  }

  const navItems = files.map((f) => `<li><a href="${f.file}">${esc(f.title || "Untitled")}</a></li>`).join("\n");
  zip.file(
    "OEBPS/nav.xhtml",
    xhtml("Contents", `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n${navItems}\n</ol></nav>`),
  );

  const id = `urn:uuid:${crypto.randomUUID()}`;
  zip.file(
    "OEBPS/toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(opts.title)}</text></docTitle>
<navMap>${files
      .map((f, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(f.title || "Untitled")}</text></navLabel><content src="${f.file}"/></navPoint>`)
      .join("")}</navMap>
</ncx>`,
  );

  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${esc(opts.title)}</dc:title>
    ${opts.author ? `<dc:creator>${esc(opts.author)}</dc:creator>` : ""}
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
    ${files.map((f, i) => `<item id="s${i + 1}" href="${f.file}" media-type="application/xhtml+xml"/>`).join("\n    ")}
  </manifest>
  <spine toc="ncx">
    <itemref idref="title"/>
    <itemref idref="nav"/>
    ${files.map((_, i) => `<itemref idref="s${i + 1}"/>`).join("\n    ")}
  </spine>
</package>`,
  );

  return zip.generateAsync({ type: "uint8array", mimeType: "application/epub+zip" });
}

// ---------------------------------------------------------------- Markdown

function inlineMd(n: JSONContent, opts: BookOptions): string {
  if (n.type === "hardBreak") return "  \n";
  if (n.type === "mention") {
    const name = mentionName(n);
    return opts.plainLinks ? name : `[[${name}]]`;
  }
  let t = n.text ?? "";
  for (const m of n.marks ?? []) {
    if (m.type === "bold") t = `**${t}**`;
    if (m.type === "italic") t = `*${t}*`;
    if (m.type === "strike") t = `~~${t}~~`;
    if (m.type === "code") t = `\`${t}\``;
    if (m.type === "link" && typeof m.attrs?.href === "string") t = `[${t}](${m.attrs.href})`;
  }
  return t;
}

function blockMd(n: JSONContent, opts: BookOptions, prefix = ""): string {
  const inner = () => (n.content ?? []).map((c) => inlineMd(c, opts)).join("");
  switch (n.type) {
    case "doc":
      return (n.content ?? []).map((c) => blockMd(c, opts)).join("");
    case "paragraph":
      return `${prefix}${inner()}\n\n`;
    case "heading":
      return `${"#".repeat(Math.min(6, (n.attrs?.level ?? 1) + 2))} ${inner()}\n\n`;
    case "blockquote":
      return (n.content ?? []).map((c) => blockMd(c, opts, "> ")).join("");
    case "bulletList":
    case "orderedList":
      return (
        (n.content ?? [])
          .map((li, i) => {
            const marker = n.type === "orderedList" ? `${i + 1}. ` : "- ";
            return marker + blockMd(li, opts).trim().replace(/\n/g, "\n   ");
          })
          .join("\n") + "\n\n"
      );
    case "listItem":
      return (n.content ?? []).map((c) => blockMd(c, opts)).join("");
    case "codeBlock":
      return "```\n" + (n.content ?? []).map((c) => c.text ?? "").join("") + "\n```\n\n";
    case "horizontalRule":
      return "---\n\n";
    default:
      return "";
  }
}

function toMarkdown(sections: Section[], opts: BookOptions): Uint8Array {
  let md = `# ${opts.title}\n\n${opts.author ? `*${opts.author}*\n\n` : ""}`;
  for (const s of sections) {
    if (s.kind === "part") md += `\n# ${s.title}\n\n`;
    else {
      if (opts.chapterTitles) md += `\n## ${s.title}\n\n`;
      if (s.body) md += blockMd(s.body, opts);
    }
  }
  return new TextEncoder().encode(md.replace(/\n{3,}/g, "\n\n").trim() + "\n");
}

// ---------------------------------------------------------------- Word

/** "#f2c94c66" -> "F2C94C" (Word has no transparency). */
const hex6 = (c: unknown) => (typeof c === "string" && /^#[0-9a-f]{6}/i.test(c) ? c.slice(1, 7).toUpperCase() : undefined);

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function runs(nodes: JSONContent[] | undefined, opts: BookOptions): ParagraphChild[] {
  return (nodes ?? []).map((n) => {
    if (n.type === "hardBreak") return new TextRun({ text: "", break: 1 });
    if (n.type === "mention") return new TextRun({ text: mentionName(n), smallCaps: !opts.plainLinks });
    const marks = new Map((n.marks ?? []).map((m) => [m.type, m.attrs ?? {}]));
    const highlight = hex6(marks.get("highlight")?.color);
    const run = new TextRun({
      text: n.text ?? "",
      bold: marks.has("bold"),
      italics: marks.has("italic"),
      strike: marks.has("strike"),
      underline: marks.has("underline") || marks.has("link") ? {} : undefined,
      superScript: marks.has("superscript"),
      subScript: marks.has("subscript"),
      color: hex6(marks.get("textStyle")?.color) ?? (marks.has("link") ? "1F6FB2" : undefined),
      shading: highlight ? { type: ShadingType.CLEAR, fill: highlight, color: "auto" } : undefined,
    });
    const href = marks.get("link")?.href;
    return typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? new ExternalHyperlink({ link: href, children: [run] }) : run;
  });
}

function docxBlocks(n: JSONContent, opts: BookOptions, quote = false): Paragraph[] {
  switch (n.type) {
    case "doc":
    case "blockquote":
      return (n.content ?? []).flatMap((c) => docxBlocks(c, opts, quote || n.type === "blockquote"));
    case "paragraph":
      return [new Paragraph({ children: runs(n.content, opts), indent: quote ? { left: 720 } : undefined, alignment: ALIGN[n.attrs?.textAlign] })];
    case "heading":
      return [new Paragraph({ children: runs(n.content, opts), heading: HeadingLevel.HEADING_3, alignment: ALIGN[n.attrs?.textAlign] })];
    case "bulletList":
    case "orderedList":
      return (n.content ?? []).flatMap((li) =>
        (li.content ?? []).flatMap((p) =>
          p.type === "paragraph" ? [new Paragraph({ children: runs(p.content, opts), bullet: { level: 0 } })] : docxBlocks(p, opts),
        ),
      );
    case "codeBlock":
      return [new Paragraph({ children: [new TextRun({ text: (n.content ?? []).map((c) => c.text ?? "").join(""), font: "Consolas" })] })];
    case "horizontalRule":
      return [new Paragraph({ children: [new TextRun("*   *   *")], alignment: AlignmentType.CENTER })];
    default:
      return [];
  }
}

async function toDocx(sections: Section[], opts: BookOptions): Promise<Uint8Array> {
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: opts.title, size: 56 })], alignment: AlignmentType.CENTER, spacing: { before: 3000, after: 400 } }),
  ];
  if (opts.author) children.push(new Paragraph({ children: [new TextRun({ text: opts.author, size: 28 })], alignment: AlignmentType.CENTER }));
  for (const s of sections) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    if (s.kind === "part") {
      children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 2400 } }));
      continue;
    }
    if (opts.chapterTitles)
      children.push(new Paragraph({ text: s.title, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 600 } }));
    if (s.body) children.push(...docxBlocks(s.body, opts));
  }
  const doc = new Document({
    creator: opts.author || undefined,
    title: opts.title,
    styles: {
      default: {
        document: { run: { font: "Georgia", size: 24 }, paragraph: { spacing: { line: 360, after: 120 } } },
      },
    },
    sections: [{ children }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

// ----------------------------------------------------------------

export const EXTENSIONS: Record<BookFormat, { ext: string; name: string }> = {
  epub: { ext: "epub", name: "EPUB ebook" },
  docx: { ext: "docx", name: "Word document" },
  md: { ext: "md", name: "Markdown" },
};

export async function buildBook(projectId: string, opts: BookOptions): Promise<Uint8Array> {
  const sections = await gather(projectId, opts);
  if (opts.format === "epub") return toEpub(sections, opts);
  if (opts.format === "docx") return toDocx(sections, opts);
  return toMarkdown(sections, opts);
}
