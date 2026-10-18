import { api, newId } from "./api";
import { useStore } from "../store";
import type { Entry, Project } from "./types";

export async function createEntry(typeId: string, title = "", navigate = true) {
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

/** Asks for confirmation, then deletes. Returns true if the entry was deleted. */
export async function confirmDeleteEntry(id: string, title: string) {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  if (!(await ask(`Delete "${title || "Untitled"}"? This can't be undone.`, { title: "Delete entry", kind: "warning" }))) return false;
  await api.deleteEntry(id);
  const { removeEntry, notify } = useStore.getState();
  removeEntry(id);
  notify(`Deleted ${title || "entry"}`);
  return true;
}
