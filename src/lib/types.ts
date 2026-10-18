import type { JSONContent } from "@tiptap/react";

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "boolean"
  | "entry"
  | "entries"
  | "list"
  | "url";

export interface FieldDef {
  /** Stable id: values are stored under this, so labels can be renamed freely. */
  id: string;
  label: string;
  kind: FieldKind;
  /** Choices for select / multiselect. */
  options?: string[];
  /** For entry / entries: which entry types may be linked. Empty means any. */
  targetTypes?: string[];
  /** Optional heading the field is grouped under in the infobox. */
  section?: string;
  help?: string;
}

export interface EntryType {
  id: string;
  name: string;
  plural: string;
  icon: string;
  color: string;
  sort: number;
  fields: FieldDef[];
}

export type Visibility = "public" | "spoiler" | "private";

/** Paragraph fields hold a rich-text document so they can contain @mentions. */
export type FieldValue = string | number | boolean | string[] | JSONContent | null;

export interface Entry {
  id: string;
  typeId: string;
  title: string;
  aliases: string[];
  summary: string;
  body: JSONContent | null;
  fields: Record<string, FieldValue>;
  tags: string[];
  image: string | null;
  /** Stands in for the entry wherever it's listed when there's no image. */
  emoji: string | null;
  visibility: Visibility;
  createdAt?: string;
  updatedAt?: string;
}

export interface EntrySummary {
  id: string;
  typeId: string;
  title: string;
  aliases: string[];
  summary: string;
  tags: string[];
  image: string | null;
  emoji: string | null;
  updatedAt: string;
}

export interface Backlink {
  sourceKind: "entry" | "doc";
  sourceId: string;
  title: string;
  parentId: string;
  via: string;
}

export interface SearchHit {
  kind: "entry" | "doc";
  id: string;
  title: string;
  snippet: string;
}

export interface WorldInfo {
  path: string;
  assetsPath: string;
  name: string;
  description: string;
  genre: string;
}

export interface RecentWorld {
  path: string;
  name: string;
  openedAt: number;
}

export interface Project {
  id: string;
  title: string;
  kind: "book" | "campaign" | "notes";
  description: string;
  sort: number;
  settings: Record<string, unknown>;
}

export interface DocSummary {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: "folder" | "text";
  title: string;
  synopsis: string;
  status: string;
  wordCount: number;
  sort: number;
}

export interface Doc extends DocSummary {
  body: JSONContent | null;
}
