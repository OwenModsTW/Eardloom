// A small Markdown reader for what assistants write: paragraphs, headings, lists, rules,
// bold, italics and code. Used to display replies and to turn proposed articles into
// formatted entry text.

export type MdBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

export interface MdSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

const BULLET = /^\s*[-*•] +/;
const NUMBER = /^\s*\d+[.)] +/;
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const last = () => blocks[blocks.length - 1];
  for (const raw of text.trim().split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] }); // paragraph break
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2].replace(/\s*#+\s*$/, "") });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
    } else if (BULLET.test(line) || NUMBER.test(line)) {
      const kind = BULLET.test(line) ? "ul" : "ol";
      const item = line.replace(kind === "ul" ? BULLET : NUMBER, "");
      const prev = last();
      if (prev?.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else {
      const prev = last();
      // An indented line straight after a list item continues it; otherwise it joins the paragraph.
      if ((prev?.kind === "ul" || prev?.kind === "ol") && /^\s+/.test(raw)) prev.items[prev.items.length - 1] += " " + line.trim();
      else if (prev?.kind === "p") prev.lines.push(line.trim());
      else blocks.push({ kind: "p", lines: [line.trim()] });
    }
  }
  return blocks.filter((b) => b.kind !== "p" || b.lines.length);
}

/** Splits a line into plain, **bold**, *italic* and `code` spans. */
export function parseInline(text: string): MdSpan[] {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return { text: part.slice(2, -2), bold: true };
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return { text: part.slice(1, -1), italic: true };
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return { text: part.slice(1, -1), code: true };
      return { text: part };
    });
}
