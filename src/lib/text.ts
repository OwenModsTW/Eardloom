import type { JSONContent } from "@tiptap/react";
import { useStore } from "../store";
import { mentionText } from "./editor/mention";

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "listItem", "codeBlock"]);

/** Plain-text paragraphs from a TipTap document; mentions use the entry's current title. */
export function toParagraphs(doc: JSONContent | null | undefined): string[] {
  if (!doc) return [];
  const entries = useStore.getState().entries;
  const out: string[] = [];
  let line = "";
  const walk = (n: JSONContent) => {
    if (n.type === "mention") line += mentionText(n.attrs, entries.find((e) => e.id === n.attrs?.id)?.title);
    if (n.text) line += n.text;
    n.content?.forEach(walk);
    if (n.type && BLOCKS.has(n.type) && line.trim()) {
      out.push(line.trim());
      line = "";
    }
  };
  walk(doc);
  if (line.trim()) out.push(line.trim());
  return out;
}
