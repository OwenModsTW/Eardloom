import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { api, newId } from "../api";
import { useStore } from "../../store";
import { CommentMark, useActiveEditor } from "../editor/comment";
import { findMatches } from "../editor/search";
import type { Entry, EntrySummary, FieldDef, FieldValue } from "../types";

type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];

/** Plain paragraphs (blank-line separated) as editor content. */
export function paragraphs(text: string): JSONContent[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
}

function findEntry(key: string): EntrySummary | undefined {
  const k = key.trim().toLowerCase();
  const { entries } = useStore.getState();
  return entries.find((e) => e.id === key) ?? entries.find((e) => [e.title, ...e.aliases].some((n) => n.toLowerCase() === k));
}

/** Converts the AI's field values (keyed by label) into stored values for this category's fields. */
function convertFields(defs: FieldDef[], input: unknown, notes: string[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  if (!input || typeof input !== "object") return out;
  for (const [label, raw] of Object.entries(input as Args)) {
    const f = defs.find((d) => d.label.toLowerCase() === label.trim().toLowerCase());
    if (!f) {
      notes.push(`There's no "${label}" field, so it was left out.`);
      continue;
    }
    switch (f.kind) {
      case "number": {
        const n = Number(raw);
        if (Number.isFinite(n)) out[f.id] = n;
        break;
      }
      case "boolean":
        out[f.id] = raw === true || /^(yes|true)$/i.test(String(raw));
        break;
      case "select": {
        const opt = f.options?.find((o) => o.toLowerCase() === String(raw).toLowerCase());
        out[f.id] = opt ?? String(raw);
        break;
      }
      case "multiselect":
      case "list":
        out[f.id] = strList(raw);
        break;
      case "entry":
      case "entries": {
        const ids: string[] = [];
        for (const name of strList(raw)) {
          const e = findEntry(name);
          if (e) ids.push(e.id);
          else notes.push(`"${name}" isn't an entry yet, so it wasn't linked from ${f.label}.`);
        }
        out[f.id] = f.kind === "entry" ? (ids[0] ?? null) : ids;
        break;
      }
      case "longtext":
        out[f.id] = { type: "doc", content: paragraphs(String(raw)) };
        break;
      case "worlddate":
        if (raw && typeof raw === "object" && typeof (raw as { year?: unknown }).year === "number") out[f.id] = raw as FieldValue;
        else notes.push(`${f.label} needs a date on the world's calendar; set it yourself.`);
        break;
      default:
        out[f.id] = String(raw);
    }
  }
  return out;
}

async function saveEntry(entry: Entry) {
  await api.saveEntry(entry);
  useStore.getState().patchEntry({ ...entry, updatedAt: new Date().toISOString() });
}

/** A short-lived editor for changing a chapter that isn't open on screen. */
function headless(content: JSONContent | null) {
  return new Editor({
    extensions: [
      StarterKit,
      Mention,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Subscript,
      Superscript,
      CommentMark,
    ],
    content: content ?? undefined,
  });
}

/**
 * Runs `change` against the chapter: in the live editor if it's open (so nothing the
 * author is typing gets overwritten), otherwise on a stored copy that's then saved.
 */
async function withChapter(docId: string, change: (editor: Editor) => string | null): Promise<string> {
  const active = useActiveEditor.getState();
  if (active.editor && active.docId === docId) {
    return change(active.editor) ?? "Couldn't find that exact passage in the chapter.";
  }
  const doc = await api.getDoc(docId);
  const editor = headless(doc.body);
  try {
    const result = change(editor);
    if (!result) return "Couldn't find that exact passage in the chapter.";
    await api.saveDoc({ ...doc, body: editor.getJSON() });
    return result;
  } finally {
    editor.destroy();
  }
}

/** Applies an approved proposal; the returned text is what the AI is told happened. */
export async function applyProposal(tool: string, args: Args): Promise<string> {
  const { types } = useStore.getState();
  const notes: string[] = [];
  const withNotes = (msg: string) => (notes.length ? `${msg} Notes: ${notes.join(" ")}` : msg);

  if (tool === "propose_new_entry") {
    const cat = str(args.category).toLowerCase();
    const type = types.find((t) => t.name.toLowerCase() === cat || t.plural.toLowerCase() === cat);
    if (!type) return `There's no "${args.category}" category. Ask the author whether to create it.`;
    const title = str(args.title);
    if (findEntry(title)) return `An entry called "${title}" already exists. Propose changes to it instead.`;
    const article = str(args.article);
    const entry: Entry = {
      id: newId(),
      typeId: type.id,
      title,
      aliases: strList(args.aliases),
      summary: str(args.summary),
      body: article ? { type: "doc", content: paragraphs(article) } : null,
      fields: convertFields(type.fields, args.fields, notes),
      tags: strList(args.tags),
      image: null,
      emoji: null,
      visibility: "public",
    };
    await saveEntry(entry);
    return withNotes(`Created "${title}" in ${type.plural}.`);
  }

  if (tool === "propose_entry_changes") {
    const found = findEntry(str(args.entry));
    if (!found) return `There's no entry called "${args.entry}".`;
    const entry = await api.getEntry(found.id);
    const type = types.find((t) => t.id === entry.typeId);
    const add = str(args.add_to_article) || str(args.article);
    const next: Entry = {
      ...entry,
      summary: str(args.summary) || entry.summary,
      aliases: [...new Set([...entry.aliases, ...strList(args.add_aliases)])],
      tags: [...new Set([...entry.tags, ...strList(args.add_tags)])],
      fields: { ...entry.fields, ...convertFields(type?.fields ?? [], args.fields, notes) },
      body: add ? { type: "doc", content: [...(entry.body?.content ?? []), ...paragraphs(add)] } : entry.body,
    };
    await saveEntry(next);
    return withNotes(`Updated "${entry.title}".`);
  }

  if (tool === "comment_on_chapter") {
    const docId = str(args.chapter_id);
    const quote = str(args.quote);
    const commentId = newId();
    const result = await withChapter(docId, (editor) => {
      const m = findMatches(editor.state.doc, quote, { caseSensitive: true, wholeWord: false })[0];
      if (!m) return null;
      editor.view.dispatch(editor.state.tr.addMark(m.from, m.to, editor.schema.marks.comment.create({ id: commentId })));
      return "Comment added to the chapter.";
    });
    if (result.startsWith("Comment added")) {
      await api.saveComment({ id: commentId, docId, body: `${str(args.note)}\n— AI suggestion`, resolved: false });
    }
    return result;
  }

  if (tool === "suggest_line_edit") {
    const original = str(args.original);
    const replacement = String(args.replacement ?? "");
    return withChapter(str(args.chapter_id), (editor) => {
      const m = findMatches(editor.state.doc, original, { caseSensitive: true, wholeWord: false })[0];
      if (!m) return null;
      editor.view.dispatch(editor.state.tr.insertText(replacement, m.from, m.to));
      return "The author applied your edit.";
    });
  }

  return `Unknown proposal "${tool}".`;
}
