import { api, newId } from "./api";
import type { Entry } from "./types";

/** A starting point for new entries in one category: fields, article, summary, tags and icon. */
export interface EntryTemplate {
  id: string;
  name: string;
  data: Pick<Entry, "summary" | "body" | "fields" | "tags" | "emoji">;
}

type Store = Record<string, EntryTemplate[]>;

async function load(): Promise<Store> {
  try {
    const v = JSON.parse((await api.getWorldSetting("entry_templates")) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const save = (all: Store) => api.setWorldSetting("entry_templates", JSON.stringify(all));

export async function listTemplates(typeId: string): Promise<EntryTemplate[]> {
  return (await load())[typeId] ?? [];
}

/** Keeps an entry's content (not its name, aliases or image) as a template for its category. */
export async function saveAsTemplate(entry: Entry, name: string) {
  const all = await load();
  const t: EntryTemplate = {
    id: newId(),
    name,
    data: { summary: entry.summary, body: entry.body, fields: entry.fields, tags: entry.tags, emoji: entry.emoji },
  };
  all[entry.typeId] = [...(all[entry.typeId] ?? []).filter((x) => x.name !== name), t];
  await save(all);
}

export async function deleteTemplate(typeId: string, id: string) {
  const all = await load();
  all[typeId] = (all[typeId] ?? []).filter((t) => t.id !== id);
  await save(all);
}
