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
  | "url"
  | "worlddate";

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
  /** For entry / entries: what the link is called from the other end ("Homeworld" -> "Native peoples"). */
  inverse?: string;
  /** For entry / entries: the field's part in family trees. */
  family?: FamilyRole;
}

export type FamilyRole = "parents" | "children" | "partners" | "siblings";

/** A year in an era (era-relative), optionally narrowed to a month and day. */
export interface WorldDatePoint {
  era?: string;
  year: number;
  /** Index into the calendar's months. */
  month?: number;
  day?: number;
}

export interface WorldDate extends WorldDatePoint {
  /** For spans: reigns, wars, lifetimes. */
  end?: WorldDatePoint;
  /** "circa" */
  approx?: boolean;
}

export interface Era {
  id: string;
  name: string;
  abbr: string;
  /** Length in years. The last era is usually open-ended (null). */
  length: number | null;
}

export interface Calendar {
  eras: Era[];
  months: { name: string; days: number }[];
}

export interface TimelineItem {
  entryId: string;
  typeId: string;
  title: string;
  summary: string;
  emoji: string | null;
  fieldId: string;
  date: WorldDate;
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

/** What a saved version of an entry holds: everything the author writes in it. */
export type EntryVersionData = Pick<Entry, "title" | "aliases" | "summary" | "body" | "fields" | "tags" | "image" | "emoji">;

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
  sourceKind: "entry" | "doc" | "map";
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
  /** Id of one of the project's labels, or "". */
  label: string;
  wordCount: number;
  sort: number;
  /** What happens in it, in terms of the world: who, where, when and which plot threads. */
  meta: SceneMeta;
}

/** A manuscript document's scene details. Entry ids throughout. */
export interface SceneMeta {
  /** Whose point of view it's told from. */
  pov?: string;
  location?: string;
  /** When it happens, on the world's calendar. */
  date?: WorldDate;
  /** Plot threads it moves forward (ids from the book's settings). */
  threads?: string[];
  /** Who's there besides those mentioned in the text, and who's mentioned but not there. */
  present?: string[];
  absent?: string[];
}

export interface Doc extends DocSummary {
  body: JSONContent | null;
}
