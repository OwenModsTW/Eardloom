import type { JSONContent } from "@tiptap/react";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface HtmlOptions {
  /** Renders an @mention node; return already-escaped HTML. */
  mention: (node: JSONContent) => string;
  /** Added to heading levels, so headings sit below the page's own title. */
  headingOffset: number;
}

function inline(n: JSONContent, o: HtmlOptions): string {
  if (n.type === "hardBreak") return "<br/>";
  if (n.type === "mention") return o.mention(n);
  let html = esc(n.text ?? "");
  for (const m of n.marks ?? []) {
    if (m.type === "bold") html = `<strong>${html}</strong>`;
    if (m.type === "italic") html = `<em>${html}</em>`;
    if (m.type === "strike") html = `<s>${html}</s>`;
    if (m.type === "underline") html = `<u>${html}</u>`;
    if (m.type === "code") html = `<code>${html}</code>`;
  }
  return html;
}

/** TipTap/ProseMirror JSON to XHTML-safe HTML. */
export function docToHtml(n: JSONContent | null | undefined, o: HtmlOptions): string {
  if (!n) return "";
  const inner = () => (n.content ?? []).map((c) => inline(c, o)).join("");
  const kids = () => (n.content ?? []).map((c) => docToHtml(c, o)).join("");
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph":
      return `<p>${inner()}</p>`;
    case "heading": {
      const level = Math.min(6, (n.attrs?.level ?? 1) + o.headingOffset);
      return `<h${level}>${inner()}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${kids()}</blockquote>`;
    case "bulletList":
      return `<ul>${kids()}</ul>`;
    case "orderedList":
      return `<ol>${kids()}</ol>`;
    case "listItem":
      return `<li>${kids()}</li>`;
    case "codeBlock":
      return `<pre>${esc((n.content ?? []).map((c) => c.text ?? "").join(""))}</pre>`;
    case "horizontalRule":
      return `<hr/>`;
    default:
      return n.content ? kids() : "";
  }
}
