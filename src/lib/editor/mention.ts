import Mention from "@tiptap/extension-mention";

/**
 * An @mention of an entry. `display` is how it reads in the text ("Vex", "the Captain");
 * without it the mention shows the entry's current title. Shared by every editor so no
 * editor drops the chosen wording when it saves.
 */
export const EntryMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      display: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-display"),
        renderHTML: (a: { display?: string | null }) => (a.display ? { "data-display": a.display } : {}),
      },
    };
  },
});

/** The ways an entry is likely to be written in prose: full name, first and last name, aliases. */
export function nameVariants(e: { title: string; aliases: string[] }): string[] {
  const words = e.title.trim().split(/\s+/).filter(Boolean);
  const out = [e.title.trim(), ...(words.length >= 2 ? [words[0], words[words.length - 1]] : []), ...e.aliases.map((a) => a.trim())];
  return [...new Set(out.filter((n) => n.length >= 2 || n === e.title.trim()))].filter(Boolean);
}

/** How a mention reads: its chosen wording, else the entry's current title, else the name it was given. */
export function mentionText(attrs: Record<string, unknown> | undefined, currentTitle?: string): string {
  const display = typeof attrs?.display === "string" ? attrs.display.trim() : "";
  return display || currentTitle || String(attrs?.label ?? "");
}
