import { invoke } from "@tauri-apps/api/core";
import type {
  Backlink,
  Doc,
  DocSummary,
  Entry,
  EntrySummary,
  EntryType,
  Project,
  RecentWorld,
  SearchHit,
  WorldInfo,
} from "./types";

/** Typed wrappers around the Rust commands in src-tauri/src. */
export const api = {
  listRecentWorlds: () => invoke<RecentWorld[]>("list_recent_worlds"),
  forgetRecentWorld: (path: string) => invoke<void>("forget_recent_world", { path }),
  defaultWorldsDir: () => invoke<string>("default_worlds_dir"),
  createWorld: (args: { parentDir: string; name: string; description: string; genre: string; types: EntryType[] }) =>
    invoke<WorldInfo>("create_world", args),
  openWorld: (path: string) => invoke<WorldInfo>("open_world", { path }),
  closeWorld: () => invoke<void>("close_world"),
  updateWorldInfo: (name: string, description: string) =>
    invoke<WorldInfo>("update_world_info", { name, description }),
  importAsset: (source: string) => invoke<string>("import_asset", { source }),

  listTypes: () => invoke<EntryType[]>("list_types"),
  saveType: (entryType: EntryType) => invoke<void>("save_type", { entryType }),
  deleteType: (id: string) => invoke<void>("delete_type", { id }),

  listEntries: () => invoke<EntrySummary[]>("list_entries"),
  getEntry: (id: string) => invoke<Entry>("get_entry", { id }),
  saveEntry: (entry: Entry) => invoke<void>("save_entry", { entry }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  backlinks: (id: string) => invoke<Backlink[]>("backlinks", { id }),
  search: (query: string, limit?: number) => invoke<SearchHit[]>("search", { query, limit }),

  listProjects: () => invoke<Project[]>("list_projects"),
  saveProject: (project: Project) => invoke<void>("save_project", { project }),
  deleteProject: (id: string) => invoke<void>("delete_project", { id }),
  listDocs: (projectId: string) => invoke<DocSummary[]>("list_docs", { projectId }),
  getDoc: (id: string) => invoke<Doc>("get_doc", { id }),
  saveDoc: (doc: Doc) => invoke<number>("save_doc", { doc }),
  moveDocs: (positions: { id: string; parentId: string | null; sort: number }[]) =>
    invoke<void>("move_docs", { positions }),
  deleteDoc: (id: string) => invoke<void>("delete_doc", { id }),
};

export const newId = (): string => crypto.randomUUID();
