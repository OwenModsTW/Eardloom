import type { ReactNode } from "react";

/** Inline **bold**, *italic* and `code`. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "hr" };

const BULLET = /^\s*[-*•] +/;
const NUMBER = /^\s*\d+[.)] +/;

function parse(text: string): Block[] {
  const blocks: Block[] = [];
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

/** Renders everyday Markdown: paragraphs, headings, lists, rules, bold, italics and code. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parse(text).map((b, i) => {
        if (b.kind === "h") return <p key={i} className={`md-h md-h${Math.min(b.level, 4)}`}>{inline(b.text)}</p>;
        if (b.kind === "hr") return <hr key={i} />;
        if (b.kind === "p") return <p key={i}>{inline(b.lines.join(" "))}</p>;
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
