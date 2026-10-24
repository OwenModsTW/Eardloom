// A stand-in for Eardloom's backend, used only by the automatic page tests (vite --mode smoke).
// It serves a small sample world from memory, so every page can be opened in an ordinary
// browser. Fixture types come from the backend's generated bindings, so they can't drift from
// what the real backend sends. Never part of the app itself.

import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { JSONContent } from "@tiptap/react";
import { useStore } from "../store";
import type * as B from "../lib/bindings";
import type { Calendar, Doc, Entry, EntryType, Project, TimelineItem } from "../lib/types";
import type { WorldMap } from "../lib/maps/model";

const WORLD: B.WorldInfo = { path: "C:/Sample World", assetsPath: "C:/Sample World/assets", name: "The Sample Isles", description: "A small world for testing.", genre: "fantasy" };
const NOW = "2026-10-24 12:00:00";

const t = (text: string, marks?: string[]): JSONContent => ({ type: "text", text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const mention = (id: string, label: string, display?: string): JSONContent => ({ type: "mention", attrs: { id, label, ...(display ? { display } : {}) } });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

const types: EntryType[] = [
  {
    id: "t_char", name: "Character", plural: "Characters", icon: "User", color: "#e0a458", sort: 0,
    fields: [
      { id: "f_born", label: "Born", kind: "worlddate" },
      { id: "f_home", label: "Home", kind: "entry", targetTypes: ["t_place"], inverse: "Residents" },
      { id: "f_traits", label: "Traits", kind: "list" },
      { id: "f_parents", label: "Parents", kind: "entries", targetTypes: ["t_char"], section: "Family", family: "parents", inverse: "Children" },
      { id: "f_partners", label: "Partners", kind: "entries", targetTypes: ["t_char"], section: "Family", family: "partners", inverse: "Partners" },
    ],
  },
  {
    id: "t_place", name: "Place", plural: "Places", icon: "MapPin", color: "#6fb58a", sort: 1,
    fields: [
      { id: "f_pop", label: "Population", kind: "number" },
      { id: "f_ruler", label: "Ruler", kind: "entry", targetTypes: ["t_char"], inverse: "Rules" },
    ],
  },
];

const entry = (e: Partial<Entry> & Pick<Entry, "id" | "typeId" | "title">): Entry => ({
  aliases: [], summary: "", body: null, fields: {}, tags: [], image: null, emoji: null, visibility: "public", createdAt: NOW, updatedAt: NOW, ...e,
});

const entries = new Map<string, Entry>(
  [
    entry({
      id: "e_vex", typeId: "t_char", title: "Vex Arandel", aliases: ["the Captain"], summary: "Captain of the harbour watch.", tags: ["crew"], emoji: "⚓",
      fields: { f_born: { year: 412, era: "era_2" }, f_home: "e_harbour", f_traits: ["stubborn", "loyal"], f_parents: ["e_rhys"], f_partners: ["e_ilse"] },
      body: doc(
        { type: "heading", attrs: { level: 2 }, content: [t("Early life")] },
        p(t("Raised by "), mention("e_rhys", "Rhys Arandel", "her father"), t(" on the docks of "), mention("e_harbour", "Highmoor Harbour"), t(" during the long winter"), { type: "footnote", attrs: { text: "Some say it lasted three years." } }, t(".")),
        { type: "bulletList", content: [{ type: "listItem", content: [p(t("Quick with a blade"))] }, { type: "listItem", content: [p(t("Slow to forgive"))] }] },
        { type: "table", content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Year"))] }, { type: "tableHeader", content: [p(t("Event"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [p(t("430"))] }, { type: "tableCell", content: [p(t("Took command"))] }] },
        ] },
      ),
    }),
    entry({ id: "e_rhys", typeId: "t_char", title: "Rhys Arandel", summary: "A retired shipwright.", fields: { f_born: { year: 380, era: "era_2" }, f_home: "e_harbour" } }),
    entry({ id: "e_mara", typeId: "t_char", title: "Mara Arandel", summary: "Vex's younger sister.", fields: { f_parents: ["e_rhys"] }, visibility: "spoiler" }),
    entry({ id: "e_ilse", typeId: "t_char", title: "Ilse Varn", summary: "A cartographer.", fields: { f_partners: ["e_vex"] }, visibility: "private" }),
    entry({
      id: "e_harbour", typeId: "t_place", title: "Highmoor Harbour", aliases: ["the Harbour"], summary: "A busy port on the northern coast.",
      fields: { f_pop: 12000, f_ruler: "e_vex" }, body: doc(p(t("Fog rolls in most mornings.")), p(mention("e_vex", "Vex Arandel", "Vex"), t(" keeps the peace here."))),
    }),
  ].map((e) => [e.id, e]),
);

const project: Project = { id: "p_book", title: "The Long Tide", kind: "book", description: "", sort: 0, settings: {} };
const docs = new Map<string, Doc>(
  [
    { id: "d_part", projectId: "p_book", parentId: null, kind: "folder", title: "Part One", synopsis: "", status: "", label: "", wordCount: 0, sort: 1, body: null },
    {
      id: "d_ch1", projectId: "p_book", parentId: "d_part", kind: "text", title: "Chapter 1", synopsis: "The fog arrives.", status: "", label: "", wordCount: 22, sort: 1,
      body: doc(p(t("The fog came in fast, and "), mention("e_vex", "Vex Arandel", "Vex"), t(" was running along the quay before the bells began.")), p(t("Nobody "), { type: "text", text: "noticed", marks: [{ type: "comment", attrs: { id: "c1" } }] }, t(" the ship."))),
    },
    { id: "d_ch2", projectId: "p_book", parentId: "d_part", kind: "text", title: "Chapter 2", synopsis: "", status: "", label: "", wordCount: 9, sort: 2, body: doc(p(t("Morning, and the harbour was quiet again."))) },
    { id: "d_ch3", projectId: "p_book", parentId: null, kind: "text", title: "Interlude", synopsis: "", status: "", label: "", wordCount: 4, sort: 2, body: doc(p(t("A letter, unsent."))) },
  ].map((d) => [d.id, d as Doc]),
);

const map: WorldMap = {
  id: "m_isles", title: "The Isles", image: null, width: 2000, height: 1400, sort: 0, updatedAt: NOW,
  data: {
    style: "parchment", seed: 7, symbols: [], lines: [], labels: [{ id: "l1", text: "Northern Sea", x: 900, y: 300, size: 28, kind: "water" }],
    areas: [{ id: "a1", kind: "land", points: [[600, 500], [1300, 450], [1400, 900], [700, 1000]] }],
    pins: [{ id: "pin1", x: 1000, y: 700, entryId: "e_harbour" }],
  },
};

const calendar: Calendar = {
  eras: [{ id: "era_1", name: "Age of Founding", abbr: "AF", length: 300 }, { id: "era_2", name: "Age of Tides", abbr: "AT", length: null }],
  months: [{ name: "Frostmoon", days: 30 }, { name: "Thawmoon", days: 30 }],
};

// ---- derived data, computed from the fixtures the same way the backend indexes them
function mentionsIn(n: JSONContent | null | undefined, out: string[] = []) {
  if (!n) return out;
  if (n.type === "mention" && n.attrs?.id) out.push(n.attrs.id);
  n.content?.forEach((c) => mentionsIn(c, out));
  return out;
}
function links(): B.Graph["links"] {
  const out: B.Graph["links"] = [];
  for (const e of entries.values()) {
    const type = types.find((x) => x.id === e.typeId);
    for (const f of type?.fields ?? []) {
      if (f.kind !== "entry" && f.kind !== "entries") continue;
      const v = e.fields[f.id];
      for (const target of Array.isArray(v) ? v : v ? [String(v)] : []) if (entries.has(target)) out.push({ sourceKind: "entry", sourceId: e.id, targetId: target, via: f.id });
    }
    for (const target of new Set(mentionsIn(e.body))) out.push({ sourceKind: "entry", sourceId: e.id, targetId: target, via: "mention" });
  }
  for (const d of docs.values()) for (const target of new Set(mentionsIn(d.body))) out.push({ sourceKind: "doc", sourceId: d.id, targetId: target, via: "mention" });
  return out;
}
const summary = (e: Entry): B.EntrySummary => ({ id: e.id, typeId: e.typeId, title: e.title, aliases: e.aliases, summary: e.summary, tags: e.tags, image: e.image, emoji: e.emoji, updatedAt: e.updatedAt ?? NOW });
const docSummary = ({ body: _body, ...d }: Doc): B.DocSummary => d;

const localAi: B.LocalAiStatus = {
  engineInstalled: true,
  engineBytes: 40_000_000,
  runningModel: null,
  downloading: false,
  diskUsed: 5_100_000_000,
  models: [
    { id: "small", label: "Small", bytes: 2_500_000_000, vramMb: 4000, installed: false },
    { id: "standard", label: "Standard", bytes: 5_030_000_000, vramMb: 7000, installed: true },
    { id: "large", label: "Large", bytes: 9_000_000_000, vramMb: 11000, installed: false },
  ],
};
// The graphics devices as the backend reports them: a dedicated card first, then built-in graphics.
const devices: B.Device[] = [
  { id: "Vulkan1", name: "Sample Graphics 8GB", memoryMb: 8151, dedicated: true },
  { id: "Vulkan0", name: "Sample Integrated Graphics", memoryMb: 8350, dedicated: false },
];

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const commands: Record<string, (a: Args) => unknown> = {
  list_recent_worlds: (): B.RecentWorld[] => [{ path: WORLD.path, name: WORLD.name, openedAt: Date.now() }],
  default_worlds_dir: () => "C:/Worlds",
  open_world: (): B.WorldInfo => WORLD,
  create_world: (): B.WorldInfo => WORLD,
  update_world_info: (): B.WorldInfo => WORLD,
  get_world_setting: (a) => (a.key === "pinned" ? JSON.stringify(["e_vex"]) : null),
  list_types: () => types,
  list_entries: () => [...entries.values()].map(summary),
  get_entry: (a) => entries.get(a.id) ?? Promise.reject("No such entry"),
  save_entry: (a) => void entries.set(a.entry.id, { ...a.entry, updatedAt: NOW }),
  delete_entry: (a) => void entries.delete(a.id),
  backlinks: (a): B.Backlink[] =>
    links()
      .filter((l) => l.targetId === a.id)
      .map((l) => {
        const src = l.sourceKind === "entry" ? entries.get(l.sourceId) : docs.get(l.sourceId);
        return { sourceKind: l.sourceKind, sourceId: l.sourceId, title: src?.title ?? "", parentId: src && "typeId" in src ? src.typeId : (src as Doc)?.projectId ?? "", via: l.via };
      }),
  search: (a): B.SearchHit[] =>
    [...entries.values()].filter((e) => e.title.toLowerCase().includes(String(a.query).toLowerCase())).map((e) => ({ kind: "entry", id: e.id, title: e.title, snippet: e.summary })),
  incoming_link_counts: () => Object.fromEntries([...entries.keys()].map((id) => [id, links().filter((l) => l.targetId === id).length])),
  link_graph: (): B.Graph => ({ links: links(), docs: [...docs.values()].filter((d) => d.kind === "text").map((d) => ({ id: d.id, projectId: d.projectId, title: d.title })) }),
  list_entry_versions: (a): B.EntryVersionSummary[] => (a.entryId === "e_vex" ? [{ id: "v1", name: "Before the rewrite", automatic: false, wordCount: 30, createdAt: "2026-10-20 09:00:00.000" }] : []),
  get_entry_version: () => ({ ...entries.get("e_vex")!, summary: "A harbour guard.", body: doc(p(t("An earlier draft."))) }),
  list_projects: () => [project],
  list_docs: () => [...docs.values()].map(docSummary),
  get_doc: (a) => docs.get(a.id) ?? Promise.reject("No such document"),
  save_doc: (a) => (docs.set(a.doc.id, a.doc), a.doc.wordCount ?? 0),
  writing_overview: (): B.WritingOverview => ({
    recent: [{ id: "d_ch1", projectId: "p_book", title: "Chapter 1", wordCount: 22, updatedAt: NOW }],
    totals: [{ projectId: "p_book", words: 35, documents: 3 }],
  }),
  list_snapshots: (): B.SnapshotSummary[] => [{ id: "s1", name: "First draft", automatic: false, wordCount: 18, createdAt: "2026-10-20 09:00:00.000" }],
  get_snapshot_body: () => doc(p(t("The fog came in slowly."))),
  list_comments: (a): B.Comment[] => (a.docId === "d_ch1" ? [{ id: "c1", docId: "d_ch1", body: "Who noticed later?", resolved: false, createdAt: NOW }] : []),
  comment_counts: () => ({ d_ch1: 1 }),
  list_maps: () => [map],
  get_map: () => map,
  get_calendar: () => calendar,
  timeline_items: (): TimelineItem[] =>
    [...entries.values()]
      .filter((e) => e.fields.f_born)
      .map((e) => ({ entryId: e.id, typeId: e.typeId, title: e.title, summary: e.summary, emoji: e.emoji, fieldId: "f_born", date: e.fields.f_born as TimelineItem["date"] })),
  read_asset: () => new ArrayBuffer(0),
  local_ai_status: () => localAi,
  local_ai_hardware: () => devices,
  connector_status: (): B.ConnectorStatus => ({
    exe: "C:/Program Files/Eardloom/eardloom.exe",
    claudeDesktopInstalled: false, claudeDesktopConnected: false, codexInstalled: false, codexConnected: false,
    claudeCodeInstalled: false, claudeCodeConnected: false, claudeCodeCommand: "claude mcp add eardloom",
  }),
  assistant_chat_load: () => null,
  default_backup_dir: () => "C:/Backups",
  list_backups: (): B.BackupInfo[] => [],
  run_backup: (): B.BackupOutcome => ({ created: false, removed: 0, totalSize: 0 }),
  // Tauri's own plugins
  "plugin:app|version": () => "0.0.0-smoke",
  "plugin:app|name": () => "Eardloom",
  "plugin:updater|check": () => null,
};

/** Commands with no stand-in, for the tests to report. */
const missing = new Set<string>();

mockWindows("main");
mockConvertFileSrc("windows");
mockIPC(
  (cmd, args) => {
    const handler = commands[cmd];
    if (handler) return handler((args ?? {}) as Args);
    if (!cmd.startsWith("plugin:")) missing.add(cmd);
    return null;
  },
  { shouldMockEvents: true },
);

// What the page tests drive the app with.
declare global {
  interface Window {
    __smoke: { store: typeof useStore; missing: Set<string>; world: B.WorldInfo };
  }
}
window.__smoke = { store: useStore, missing, world: WORLD };
