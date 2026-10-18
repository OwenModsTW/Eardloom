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
    if (m.type === "superscript") html = `<sup>${html}</sup>`;
    if (m.type === "subscript") html = `<sub>${html}</sub>`;
    if (m.type === "highlight") html = `<mark${safeColor(m.attrs?.color) ? ` style="background-color:${m.attrs!.color}"` : ""}>${html}</mark>`;
    if (m.type === "textStyle" && safeColor(m.attrs?.color)) html = `<span style="color:${m.attrs!.color}">${html}</span>`;
    if (m.type === "link" && typeof m.attrs?.href === "string" && /^(https?:|mailto:)/i.test(m.attrs.href))
      html = `<a href="${esc(m.attrs.href)}">${html}</a>`;
  }
  return html;
}

/** Only plain colour values reach a style attribute. */
const safeColor = (c: unknown): c is string => typeof c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(c);

const align = (n: JSONContent) => {
  const a = n.attrs?.textAlign;
  return a && a !== "left" && ["center", "right", "justify"].includes(a) ? ` style="text-align:${a}"` : "";
};

/** TipTap/ProseMirror JSON to XHTML-safe HTML. */
export function docToHtml(n: JSONContent | null | undefined, o: HtmlOptions): string {
  if (!n) return "";
  const inner = () => (n.content ?? []).map((c) => inline(c, o)).join("");
  const kids = () => (n.content ?? []).map((c) => docToHtml(c, o)).join("");
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph":
      return `<p${align(n)}>${inner()}</p>`;
    case "heading": {
      const level = Math.min(6, (n.attrs?.level ?? 1) + o.headingOffset);
      return `<h${level}${align(n)}>${inner()}</h${level}>`;
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
