import { invoke } from "@tauri-apps/api/core";
import type * as B from "./bindings";

type WorldSetting = "cover" | "pinned" | "dictionary" | "entry_templates";
import type { JSONContent } from "@tiptap/react";
import type { WorldMap } from "./maps/model";
import type {
  EntryVersionData,
  Backlink,
  Calendar,
  TimelineItem,
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
  readAsset: (name: string) => invoke<ArrayBuffer>("read_asset", { name }),

  listTypes: () => invoke<EntryType[]>("list_types"),
  saveType: (entryType: EntryType) => invoke<void>("save_type", { entryType }),
  deleteType: (id: string) => invoke<void>("delete_type", { id }),

  listEntries: () => invoke<EntrySummary[]>("list_entries"),
  getEntry: (id: string) => invoke<Entry>("get_entry", { id }),
  saveEntry: (entry: Entry) => invoke<void>("save_entry", { entry }),
  deleteEntry: (id: string) => invoke<void>("delete_entry", { id }),
  /** Saves the entry as it is now; an automatic version is skipped if nothing changed. Resolves to whether one was saved. */
  createEntryVersion: (entryId: string, name: string, automatic = false) =>
    invoke<boolean>("create_entry_version", { id: crypto.randomUUID(), entryId, name, automatic }),
  listEntryVersions: (entryId: string) =>
    invoke<B.EntryVersionSummary[]>("list_entry_versions", { entryId }),
  getEntryVersion: (id: string) => invoke<EntryVersionData>("get_entry_version", { id }),
  renameEntryVersion: (id: string, name: string) => invoke<void>("rename_entry_version", { id, name }),
  deleteEntryVersion: (id: string) => invoke<void>("delete_entry_version", { id }),
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
  updateDocDetails: (id: string, details: { title?: string; synopsis?: string; status?: string; label?: string }) =>
    invoke<void>("update_doc_details", { id, details }),
  createSnapshot: (docId: string, name: string, automatic = false) =>
    invoke<void>("create_snapshot", { id: crypto.randomUUID(), docId, name, automatic }),
  listSnapshots: (docId: string) =>
    invoke<B.SnapshotSummary[]>("list_snapshots", { docId }),
  getSnapshotBody: (id: string) => invoke<JSONContent | null>("get_snapshot_body", { id }),
  renameSnapshot: (id: string, name: string) => invoke<void>("rename_snapshot", { id, name }),
  deleteSnapshot: (id: string) => invoke<void>("delete_snapshot", { id }),
  clipboardRtf: () => invoke<string | null>("clipboard_rtf"),
  listComments: (docId: string) =>
    invoke<B.Comment[]>("list_comments", { docId }),
  saveComment: (comment: { id: string; docId: string; body: string; resolved: boolean; createdAt?: string }) =>
    invoke<void>("save_comment", { comment: { createdAt: "", ...comment } }),
  deleteComment: (id: string) => invoke<void>("delete_comment", { id }),
  commentCounts: (projectId: string) => invoke<Record<string, number>>("comment_counts", { projectId }),
  listMaps: () => invoke<WorldMap[]>("list_maps"),
  getMap: (id: string) => invoke<WorldMap | null>("get_map", { id }),
  saveMap: (map: WorldMap) => invoke<void>("save_map", { map: { updatedAt: "", ...map } }),
  deleteMap: (id: string) => invoke<void>("delete_map", { id }),

  getWorldSetting: (key: WorldSetting) => invoke<string | null>("get_world_setting", { key }),
  setWorldSetting: (key: WorldSetting, value: string | null) => invoke<void>("set_world_setting", { key, value }),
  writingOverview: () =>
    invoke<B.WritingOverview>("writing_overview"),
  incomingLinkCounts: () => invoke<Record<string, number>>("incoming_link_counts"),
  getCalendar: () => invoke<Calendar | null>("get_calendar"),
  saveCalendar: (calendar: Calendar) => invoke<void>("save_calendar", { calendar }),
  timelineItems: () => invoke<TimelineItem[]>("timeline_items"),
  exportWorldPack: (dest: string, omitPrivate: boolean) => invoke<void>("export_world_pack", { dest, omitPrivate }),
  importWorldPack: (src: string, parentDir: string) => invoke<WorldInfo>("import_world_pack", { src, parentDir }),
  writeStaticSite: (dir: string, files: { path: string; content: string }[], assets: string[]) =>
    invoke<string>("write_static_site", { dir, files, assets }),
};

export const newId = (): string => crypto.randomUUID();
