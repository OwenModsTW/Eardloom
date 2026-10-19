import { api, newId } from "./api";
import { useStore } from "../store";
import type { Entry, Project } from "./types";
import type { EntryTemplate } from "./entryTemplates";

export async function createEntry(typeId: string, title = "", navigate = true, template?: EntryTemplate) {
  const entry: Entry = {
    id: newId(),
    typeId,
    title,
    aliases: [],
    summary: "",
    body: null,
    fields: {},
    tags: [],
    image: null,
    emoji: null,
    visibility: "public",
    ...(template ? structuredClone(template.data) : {}),
  };
  await api.saveEntry(entry);
  const { patchEntry, go } = useStore.getState();
  patchEntry({ ...entry, updatedAt: new Date().toISOString() });
  if (navigate) go({ view: "entry", id: entry.id });
  return entry;
}

export async function createProject(title: string, kind: Project["kind"] = "book") {
  const { projects, refreshProjects, go } = useStore.getState();
  const project: Project = { id: newId(), title, kind, description: "", sort: projects.length, settings: {} };
  await api.saveProject(project);
  const chapter = newId();
  await api.saveDoc({
    id: chapter,
    projectId: project.id,
    parentId: null,
    kind: "text",
    title: "Chapter 1",
    synopsis: "",
    status: "",
    label: "",
    body: null,
    sort: 1,
    wordCount: 0,
  });
  await refreshProjects();
  go({ view: "project", id: project.id, docId: chapter });
}

export async function duplicateEntry(id: string) {
  const source = await api.getEntry(id);
  const copy: Entry = { ...source, id: newId(), title: `${source.title} (copy)`, createdAt: undefined, updatedAt: undefined };
  await api.saveEntry(copy);
  const { patchEntry, go } = useStore.getState();
  patchEntry({ ...copy, updatedAt: new Date().toISOString() });
  go({ view: "entry", id: copy.id });
}

/**
 * Changes several entries at once. Each is saved as a version first, so the change can be
 * undone from its history. Returns how many changed.
 */
export async function bulkUpdate(ids: string[], change: (e: Entry) => Entry | null) {
  const { patchEntry } = useStore.getState();
  let n = 0;
  for (const id of ids) {
    const before = await api.getEntry(id);
    const after = change(structuredClone(before));
    if (!after || JSON.stringify(after) === JSON.stringify(before)) continue;
    await api.createEntryVersion(id, "Before a bulk change", true).catch(() => {});
    await api.saveEntry(after);
    patchEntry({ ...after, updatedAt: new Date().toISOString() });
    n++;
  }
  return n;
}

export async function bulkDelete(ids: string[]) {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  const what = ids.length === 1 ? "this entry" : `these ${ids.length} entries`;
  if (!(await ask(`Delete ${what}? This can't be undone.`, { title: "Delete entries", kind: "warning" }))) return false;
  const { removeEntry, pinned, togglePin, notify } = useStore.getState();
  for (const id of ids) {
    await api.deleteEntry(id);
    removeEntry(id);
    if (pinned.includes(id)) await togglePin(id);
  }
  notify(`Deleted ${ids.length} ${ids.length === 1 ? "entry" : "entries"}`);
  return true;
}

/** Asks for confirmation, then deletes. Returns true if the entry was deleted. */
export async function confirmDeleteEntry(id: string, title: string) {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  if (!(await ask(`Delete "${title || "Untitled"}"? This can't be undone.`, { title: "Delete entry", kind: "warning" }))) return false;
  await api.deleteEntry(id);
  const { removeEntry, notify, pinned, togglePin } = useStore.getState();
  removeEntry(id);
  if (pinned.includes(id)) await togglePin(id);
  notify(`Deleted ${title || "entry"}`);
  return true;
}
