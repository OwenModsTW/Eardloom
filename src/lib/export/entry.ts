// Sharing entries outside Eardloom: as text, Markdown, a web page, a Word document or a PDF.
// A single entry, or many (a "world guide", grouped by category).
import type { Content } from "pdfmake/interfaces";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, TextRun, type Table } from "docx";
import { useStore } from "../../store";
import { toParagraphs } from "../text";
import { mentionText } from "../editor/mention";
import { fieldText } from "./card";
import { docToHtml, esc } from "./html";
import { docToMarkdown, docxBlocks, type BookOptions, type DocxContext } from "./book";
import { imagesIn, loadImages, type LoadedImage } from "./images";
import { dataUrl, makePdf, pdfBlocks, pdfContext } from "./pdf";
import type { Entry, EntryType } from "../types";

/** What a shared entry shows: everything the author wrote, in reading order. */
export interface EntryParts {
  entry: Entry;
  type: EntryType | undefined;
  fields: { label: string; text: string; section: string }[];
}

export function entryParts(entry: Entry): EntryParts {
  const type = useStore.getState().types.find((t) => t.id === entry.typeId);
  const fields = (type?.fields ?? [])
    .map((f) => ({ label: f.label, text: fieldText(entry.fields[f.id], f.kind) ?? "", section: f.section?.trim() ?? "" }))
    .filter((f) => f.text);
  return { entry, type, fields };
}

const safeName = (s: string) => s.replace(/[<>:"/\\|?*]/g, "").trim() || "entry";
export const fileNameFor = (title: string, ext: string) => `${safeName(title)}.${ext}`;

// ---------------------------------------------------------------- text and Markdown

/** Plain text, for pasting into a message or document. */
export function entryText({ entry, type, fields }: EntryParts): string {
  const lines = [entry.title || "Untitled"];
  if (type) lines.push(type.name + (entry.aliases.length ? ` · also known as ${entry.aliases.join(", ")}` : ""));
  if (entry.summary) lines.push("", entry.summary);
  if (fields.length) lines.push("", ...fields.map((f) => `${f.label}: ${f.text}`));
  const body = toParagraphs(entry.body);
  if (body.length) lines.push("", body.join("\n\n"));
  return lines.join("\n");
}

export function entryMarkdown({ entry, type, fields }: EntryParts, level = 1): string {
  const h = "#".repeat(level);
  let md = `${h} ${entry.title || "Untitled"}\n\n`;
  if (type) md += `*${type.name}${entry.aliases.length ? ` · also known as ${entry.aliases.join(", ")}` : ""}*\n\n`;
  if (entry.summary) md += `> ${entry.summary}\n\n`;
  if (fields.length) md += `| | |\n|---|---|\n${fields.map((f) => `| **${f.label}** | ${f.text.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`).join("\n")}\n\n`;
  // The article's headings sit under the entry's own title.
  const body = docToMarkdown(entry.body, level - 1);
  if (body) md += `${body}\n\n`;
  if (entry.tags.length) md += `Tags: ${entry.tags.join(", ")}\n`;
  return md.trim() + "\n";
}

// ---------------------------------------------------------------- web page


const PAGE_CSS = `
:root { --bg:#111b1a; --raised:#162321; --line:#1f302d; --text:#ece6d5; --soft:#bcb5a3; --muted:#7c8a85; --accent:#f6bd60; color-scheme:dark; }
@media (prefers-color-scheme: light) { :root { --bg:#f4f0e6; --raised:#fbf9f3; --line:#ddd8c8; --text:#1b2826; --soft:#43514c; --muted:#737a70; --accent:#a86f12; color-scheme:light; } }
body { margin:0; background:var(--bg); color:var(--text); font:17px/1.7 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
main { max-width:760px; margin:0 auto; padding:40px 20px 80px; }
.kind { font:600 13px "Segoe UI",system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; color:var(--c, var(--accent)); margin:0; }
h1 { font-size:38px; line-height:1.2; margin:4px 0; } h2, h3, h4 { line-height:1.3; }
.aka { color:var(--muted); font-style:italic; margin:0 0 12px; }
.hero { width:100%; max-height:420px; object-fit:cover; border-radius:6px; margin:12px 0; }
.lede { font-style:italic; font-size:19px; color:var(--soft); }
.facts { width:100%; border-collapse:collapse; margin:18px 0 26px; font:15px/1.5 "Segoe UI",system-ui,sans-serif; background:var(--raised); border-top:3px solid var(--c, var(--accent)); }
.facts th { text-align:left; color:var(--muted); width:34%; font-weight:600; }
.facts th, .facts td { padding:7px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
.facts .sec th { color:var(--c, var(--accent)); text-transform:uppercase; font-size:12px; letter-spacing:.06em; }
article p { margin:0 0 .9em; } article img { max-width:100%; display:block; margin:1em auto; border-radius:4px; }
article table { border-collapse:collapse; width:100%; } article th, article td { border:1px solid var(--line); padding:5px 8px; }
blockquote { border-left:2px solid var(--accent); margin:0 0 1em; padding-left:14px; font-style:italic; color:var(--soft); }
.notes { font-size:14px; color:var(--soft); border-top:1px solid var(--line); margin-top:30px; padding-top:10px; }
.tags { font:14px "Segoe UI",system-ui,sans-serif; color:var(--muted); margin-top:30px; }
`;

/** One entry as a complete web page: opens in any browser, images included. */
export async function entryHtml(parts: EntryParts): Promise<string> {
  const { entry, type, fields } = parts;
  const images = await loadImages([...imagesIn(entry.body), ...(entry.image ? [entry.image] : [])]);
  const notes: string[] = [];
  const body = docToHtml(entry.body, {
    headingOffset: 1,
    mention: (m) => esc(mentionText(m.attrs, useStore.getState().entries.find((e) => e.id === m.attrs?.id)?.title)),
    image: (asset) => (images.has(asset) ? dataUrl(images.get(asset)!) : null),
    footnote: (text) => (notes.push(text), `<sup>${notes.length}</sup>`),
  });
  let lastSection = "";
  const rows = fields
    .map((f) => {
      const head = f.section && f.section !== lastSection ? `<tr class="sec"><th colspan="2">${esc(f.section)}</th></tr>` : "";
      lastSection = f.section;
      return `${head}<tr><th>${esc(f.label)}</th><td>${esc(f.text)}</td></tr>`;
    })
    .join("");
  const hero = entry.image && images.has(entry.image) ? `<img class="hero" src="${dataUrl(images.get(entry.image)!)}" alt=""/>` : "";
  const world = useStore.getState().world?.name;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(entry.title || "Untitled")}${world ? ` · ${esc(world)}` : ""}</title><style>${PAGE_CSS}</style></head>
<body><main style="--c:${type?.color ?? "#f6bd60"}">
<p class="kind">${esc(type?.name ?? "")}${world ? ` · ${esc(world)}` : ""}</p>
<h1>${entry.emoji ? `${esc(entry.emoji)} ` : ""}${esc(entry.title || "Untitled")}</h1>
${entry.aliases.length ? `<p class="aka">Also known as ${esc(entry.aliases.join(", "))}</p>` : ""}
${hero}
${entry.summary ? `<p class="lede">${esc(entry.summary)}</p>` : ""}
${rows ? `<table class="facts">${rows}</table>` : ""}
<article>${body}</article>
${notes.length ? `<ol class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ol>` : ""}
${entry.tags.length ? `<p class="tags">Tags: ${esc(entry.tags.join(", "))}</p>` : ""}
</main></body></html>`;
}

// ---------------------------------------------------------------- Word

const BOOK_OPTS = { plainLinks: true } as BookOptions;

function docxEntry({ entry, type, fields }: EntryParts, ctx: DocxContext, heading: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  const out: (Paragraph | Table)[] = [new Paragraph({ text: entry.title || "Untitled", heading })];
  if (type)
    out.push(
      new Paragraph({
        children: [new TextRun({ text: type.name + (entry.aliases.length ? ` · also known as ${entry.aliases.join(", ")}` : ""), italics: true, color: "777777" })],
      }),
    );
  const hero = entry.image ? ctx.images.get(entry.image) : undefined;
  if (hero) {
    const scale = Math.min(1, 480 / hero.width, 360 / hero.height);
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: hero.type, data: hero.bytes, transformation: { width: Math.round(hero.width * scale), height: Math.round(hero.height * scale) } })],
      }),
    );
  }
  if (entry.summary) out.push(new Paragraph({ children: [new TextRun({ text: entry.summary, italics: true })], spacing: { after: 200 } }));
  for (const f of fields) out.push(new Paragraph({ children: [new TextRun({ text: `${f.label}: `, bold: true }), new TextRun(f.text)] }));
  if (fields.length) out.push(new Paragraph(""));
  if (entry.body) out.push(...docxBlocks(entry.body, BOOK_OPTS, ctx));
  return out;
}

async function docxContext(entries: Entry[]): Promise<DocxContext> {
  const names = new Set<string>();
  for (const e of entries) {
    imagesIn(e.body, names);
    if (e.image) names.add(e.image);
  }
  return { images: await loadImages(names), footnotes: {}, next: 1 };
}

async function packDocx(children: (Paragraph | Table)[], title: string, ctx: DocxContext) {
  const doc = new Document({
    title,
    footnotes: ctx.footnotes,
    styles: { default: { document: { run: { font: "Georgia", size: 23 }, paragraph: { spacing: { line: 320, after: 100 } } } } },
    sections: [{ children }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}

export async function entryDocx(parts: EntryParts): Promise<Uint8Array> {
  const ctx = await docxContext([parts.entry]);
  return packDocx(docxEntry(parts, ctx, HeadingLevel.TITLE), parts.entry.title, ctx);
}

// ---------------------------------------------------------------- PDF

function pdfEntry({ entry, type, fields }: EntryParts, images: Map<string, LoadedImage>, first: boolean, inGuide = false): Content[] {
  const ctx = pdfContext(images);
  const out: Content[] = [];
  out.push({ text: (type?.name ?? "").toUpperCase(), style: "kind", color: type?.color ?? "#a86f12", pageBreak: first ? undefined : "before" });
  out.push({ text: entry.title || "Untitled", style: "title", ...(inGuide ? { tocItem: true, tocMargin: [16, 2, 0, 0], tocStyle: { fontSize: 10 } } : {}) });
  if (entry.aliases.length) out.push({ text: `Also known as ${entry.aliases.join(", ")}`, italics: true, color: "#777777", margin: [0, 0, 0, 6] });
  const hero = entry.image ? images.get(entry.image) : undefined;
  if (hero) out.push({ image: dataUrl(hero), fit: [480, 300], alignment: "center", margin: [0, 6, 0, 10] });
  if (entry.summary) out.push({ text: entry.summary, italics: true, fontSize: 12.5, color: "#444444", margin: [0, 0, 0, 10] });
  if (fields.length)
    out.push({
      table: { widths: [130, "*"], body: fields.map((f) => [{ text: f.label, bold: true, color: "#555555" }, f.text]) },
      layout: "lightHorizontalLines",
      fontSize: 10.5,
      margin: [0, 0, 0, 14],
    });
  if (entry.body) out.push(...pdfBlocks(entry.body, ctx));
  if (ctx.notes.length) out.push({ ol: ctx.notes, fontSize: 9.5, color: "#555555", margin: [0, 12, 0, 0] });
  if (entry.tags.length) out.push({ text: `Tags: ${entry.tags.join(", ")}`, fontSize: 9.5, color: "#777777", margin: [0, 14, 0, 0] });
  return out;
}

async function pdfImages(entries: Entry[]) {
  const names = new Set<string>();
  for (const e of entries) {
    imagesIn(e.body, names);
    if (e.image) names.add(e.image);
  }
  return loadImages(names, ["png", "jpg", "jpeg"]);
}

export async function entryPdf(parts: EntryParts): Promise<Uint8Array> {
  const images = await pdfImages([parts.entry]);
  return makePdf({ info: { title: parts.entry.title }, content: pdfEntry(parts, images, true) });
}

// ---------------------------------------------------------------- world guide

/** The shareable entries of a world, grouped by category in the sidebar's order. */
export function guideGroups(entries: Entry[]) {
  const { types } = useStore.getState();
  return [...types]
    .sort((a, b) => a.sort - b.sort)
    .map((t) => ({ type: t, entries: entries.filter((e) => e.typeId === t.id).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((g) => g.entries.length);
}

export async function worldGuidePdf(title: string, entries: Entry[]): Promise<Uint8Array> {
  const images = await pdfImages(entries);
  const groups = guideGroups(entries);
  const content: Content[] = [
    { text: title, style: "cover" },
    { text: `${entries.length} entries`, alignment: "center", color: "#777777" },
    { toc: { title: { text: "Contents", style: "h1" } }, pageBreak: "before" },
  ];
  for (const g of groups) {
    content.push({ text: g.type.plural, style: "part", pageBreak: "before", tocItem: true, color: g.type.color });
    for (const e of g.entries) content.push(...pdfEntry(entryParts(e), images, false, true));
  }
  return makePdf({ info: { title }, content });
}

export async function worldGuideDocx(title: string, entries: Entry[]): Promise<Uint8Array> {
  const ctx = await docxContext(entries);
  const children: (Paragraph | Table)[] = [
    new Paragraph({ children: [new TextRun({ text: title, size: 64, bold: true })], alignment: AlignmentType.CENTER, spacing: { before: 3000, after: 300 } }),
    new Paragraph({ children: [new TextRun({ text: `${entries.length} entries`, color: "777777" })], alignment: AlignmentType.CENTER }),
  ];
  for (const g of guideGroups(entries)) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ text: g.type.plural, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 2400 } }));
    for (const e of g.entries) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(...docxEntry(entryParts(e), ctx, HeadingLevel.HEADING_2));
    }
  }
  return packDocx(children, title, ctx);
}

export function worldGuideMarkdown(title: string, entries: Entry[]): string {
  let md = `# ${title}\n\n`;
  for (const g of guideGroups(entries)) {
    md += `\n## ${g.type.plural}\n\n`;
    for (const e of g.entries) md += entryMarkdown(entryParts(e), 3) + "\n";
  }
  return md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
