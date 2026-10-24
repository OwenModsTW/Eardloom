// Print-ready PDFs of a book: a standard manuscript for agents and editors, or a paperback
// interior for print-on-demand.

import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { toParagraphs } from "../text";
import { imagesIn, loadImages } from "./images";
import { makePdf, pdfBlocks, pdfContext } from "./pdf";
import { TRIMS, type BookOptions, type Section } from "./book";

const INCH = 72;
const countWords = (sections: Section[]) =>
  sections.reduce((n, s) => n + toParagraphs(s.body).join(" ").split(/\s+/).filter(Boolean).length, 0);

/** "about 90,000 words": to the nearest thousand for a novel, nearest hundred for something shorter. */
export function roundedWords(n: number) {
  const step = n < 10_000 ? 100 : 1000;
  return Math.max(step, Math.round(n / step) * step);
}

/**
 * Inside margin print-on-demand services ask for, by page count (thicker books need more room
 * in the binding). Both sides use it, so it holds whichever side of the spread a page falls on.
 */
export function bindingMargin(pages: number) {
  const inches = pages <= 150 ? 0.5 : pages <= 300 ? 0.6 : pages <= 500 ? 0.7 : pages <= 700 ? 0.8 : 0.9;
  return inches * INCH;
}

async function bookImages(sections: Section[]) {
  const names = new Set<string>();
  for (const s of sections) imagesIn(s.body, names);
  return loadImages(names, ["png", "jpg", "jpeg"]);
}

const endnotes = (notes: string[], fontSize: number): Content[] =>
  notes.length ? [{ text: "Notes", bold: true, fontSize, margin: [0, 18, 0, 4] }, { ol: notes, fontSize, margin: [0, 0, 0, 0] }] : [];

/** Standard manuscript format: Courier, double spaced, one-inch margins, a header on every page. */
async function manuscript(sections: Section[], opts: BookOptions) {
  const images = await bookImages(sections);
  const author = opts.author.trim() || "Author";
  const surname = author.split(/\s+/).pop()!;
  const short = opts.title.split(/\s+/).slice(0, 4).join(" ").toUpperCase();
  const text = { indent: 0.5 * INCH, gap: 0, flushFirst: false, sceneBreak: "#", imageWidth: 400 };
  const content: Content[] = [
    { columns: [{ text: author }, { text: `about ${roundedWords(countWords(sections)).toLocaleString("en")} words`, alignment: "right" }] },
    { text: opts.title.toUpperCase(), alignment: "center", margin: [0, 3 * INCH, 0, 24] },
    { text: `by ${author}`, alignment: "center" },
  ];
  for (const s of sections) {
    if (s.kind === "part") {
      content.push({ text: s.title.toUpperCase(), alignment: "center", pageBreak: "before", margin: [0, 3 * INCH, 0, 0] });
      continue;
    }
    // A new chapter starts a third of the way down a new page.
    content.push({ text: opts.chapterTitles ? s.title : "", alignment: "center", pageBreak: "before", margin: [0, 2.5 * INCH, 0, 24] });
    const ctx = pdfContext(images, text);
    if (s.body) content.push(...pdfBlocks(s.body, ctx));
    content.push(...endnotes(ctx.notes, 11));
  }
  content.push({ text: "END", alignment: "center", margin: [0, 24, 0, 0] });
  return makePdf(
    {
      info: { title: opts.title, author },
      pageSize: opts.paper === "a4" ? "A4" : "LETTER",
      pageMargins: [INCH, INCH, INCH, INCH],
      defaultStyle: { font: "CourierPrime", fontSize: 12, lineHeight: 1.75 },
      styles: { h1: { bold: true }, h2: { bold: true }, h3: { bold: true } },
      header: (page: number) => (page === 1 ? null : { text: `${surname} / ${short} / ${page}`, alignment: "right", margin: [INCH, 0.5 * INCH, INCH, 0], fontSize: 12, lineHeight: 1 }),
      content,
    },
    ["CourierPrime"],
  );
}

/** A paperback interior: trim size, a book typeface, chapter openings, running heads and folios. */
async function paperback(sections: Section[], opts: BookOptions) {
  const images = await bookImages(sections);
  const author = opts.author.trim();
  const [w, h] = TRIMS[opts.trim ?? "5.5x8.5"].size;
  const words = countWords(sections);
  // About 300 words a page at 5.5 × 8.5, scaled by the page area, plus chapter openings.
  const pages = Math.ceil((words / 300) * ((396 * 612) / (w * h))) + sections.length + 4;
  const side = bindingMargin(pages);
  const fontSize = w <= 378 ? 10.5 : 11;
  const text = { indent: fontSize * 1.4, gap: 0, flushFirst: true, alignment: "justify" as const, sceneBreak: "*      *      *", imageWidth: w - side * 2 };

  // Openings are a page break, then the title: the library reports where titles land (it skips
  // anything that itself starts with a page break), so a first layout can find each opening.
  const opening = (title: string, id: string, size: number, sink: number): Content[] => [
    { text: "", pageBreak: "before" },
    { text: title, id, alignment: "center", fontSize: size, margin: [0, h * sink, 0, size * 2] } as Content,
  ];

  // Built afresh for each layout (the library writes into what it's given).
  const build = (openings: Set<number>, found: Set<number>): TDocumentDefinitions => {
    const content: Content[] = [
      { text: opts.title, alignment: "center", fontSize: 26, margin: [0, h * 0.28, 0, 18] },
      ...(author ? [{ text: author, alignment: "center", fontSize: 14 } as Content] : []),
      {
        text: `Copyright © ${new Date().getFullYear()}${author ? ` ${author}` : ""}. All rights reserved.`,
        pageBreak: "before",
        fontSize: 8.5,
        alignment: "center",
        margin: [0, h * 0.62, 0, 0],
      },
    ];
    sections.forEach((s, i) => {
      if (s.kind === "part") return void content.push(...opening(s.title, `open-${i}`, 22, 0.32));
      content.push(...opening(opts.chapterTitles ? s.title : "", `open-${i}`, 17, 0.22));
      const ctx = pdfContext(images, text);
      if (s.body) content.push(...pdfBlocks(s.body, ctx));
      content.push(...endnotes(ctx.notes, fontSize - 2));
    });
    return {
      info: { title: opts.title, author: author || undefined },
      pageSize: { width: w, height: h },
      pageMargins: [side, 0.75 * INCH, side, 0.75 * INCH] as [number, number, number, number],
      defaultStyle: { font: "Crimson", fontSize, lineHeight: 1.3 },
      styles: { h1: { fontSize: fontSize + 3, margin: [0, 10, 0, 4] }, h2: { fontSize: fontSize + 2, margin: [0, 8, 0, 4] }, h3: { fontSize: fontSize + 1, italics: true } },
      pageBreakBefore: (node) => {
        if (typeof node.id === "string" && node.id.startsWith("open-") && node.startPosition) found.add(node.startPosition.pageNumber);
        return false;
      },
      // Running heads: the author on left-hand (even) pages, the title on right-hand ones; none on
      // the opening page of a chapter or part.
      header: (page: number) =>
        page <= 2 || openings.has(page)
          ? null
          : {
              text: (page % 2 === 0 ? author || opts.title : opts.title).toUpperCase(),
              alignment: "center" as const,
              fontSize: 7.5,
              characterSpacing: 1.5,
              color: "#444444",
              margin: [side, 0.42 * INCH, side, 0] as [number, number, number, number],
            },
      footer: (page: number) => (page <= 2 ? null : { text: String(page), alignment: "center" as const, fontSize: 9, margin: [0, 0.3 * INCH, 0, 0] as [number, number, number, number] }),
      content,
    };
  };

  // First layout finds where chapters open; the second draws the running heads around them.
  const openings = new Set<number>();
  await makePdf(build(new Set(), openings), ["Crimson"]);
  return makePdf(build(openings, new Set()), ["Crimson"]);
}

export function bookPdf(sections: Section[], opts: BookOptions) {
  return opts.pdfLayout === "manuscript" ? manuscript(sections, opts) : paperback(sections, opts);
}
