import type { ReactNode } from "react";
import { parseInline, parseMarkdown } from "../lib/markdown";

function inline(text: string): ReactNode[] {
  return parseInline(text).map((s, i) =>
    s.bold ? <strong key={i}>{s.text}</strong> : s.italic ? <em key={i}>{s.text}</em> : s.code ? <code key={i}>{s.text}</code> : s.text,
  );
}

/** Renders everyday Markdown: paragraphs, headings, lists, rules, bold, italics and code. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {parseMarkdown(text).map((b, i) => {
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
