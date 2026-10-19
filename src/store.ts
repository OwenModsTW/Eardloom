import { create } from "zustand";
import { api } from "./lib/api";
import type { Calendar, EntrySummary, EntryType, Project, WorldInfo } from "./lib/types";
import { EMPTY_CALENDAR } from "./lib/calendar";
import { backupOnClose } from "./lib/backup";

export type Route =
  | { view: "dashboard" }
  | { view: "type"; typeId: string }
  | { view: "entry"; id: string }
  | { view: "project"; id: string; docId?: string }
  | { view: "schema"; typeId?: string }
  | { view: "settings" }
  | { view: "timeline" }
  | { view: "calendar" }
  | { view: "graph"; focus?: string };

interface State {
  world: WorldInfo | null;
  types: EntryType[];
  entries: EntrySummary[];
  projects: Project[];
  calendar: Calendar;
  /** Entries pinned to the world's home page. */
  pinned: string[];
  cover: string | null;
  /** Words learned for this world's spellchecker. */
  dictionary: string[];

  route: Route;
  back: Route[];
  forward: Route[];
  paletteOpen: boolean;
  toast: string | null;
  /** Distraction-free writing: hides everything but the page. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;

  openWorld: (world: WorldInfo) => Promise<void>;
  closeWorld: () => Promise<void>;
  setWorld: (world: WorldInfo) => void;
  setCalendar: (calendar: Calendar) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  learnWord: (word: string) => Promise<void>;
  forgetWord: (word: string) => Promise<void>;
  setCover: (asset: string | null) => Promise<void>;
  refreshTypes: () => Promise<void>;
  refreshEntries: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  /** Patches the cached summary after a save, so lists update without a reload. */
  patchEntry: (summary: EntrySummary) => void;
  removeEntry: (id: string) => void;

  go: (route: Route) => void;
  goBack: () => void;
  goForward: () => void;
  setPalette: (open: boolean) => void;
  notify: (message: string) => void;
}

const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export const useStore = create<State>((set, get) => ({
  world: null,
  types: [],
  entries: [],
  projects: [],
  calendar: EMPTY_CALENDAR,
  pinned: [],
  cover: null,
  dictionary: [],
  route: { view: "dashboard" },
  back: [],
  forward: [],
  paletteOpen: false,
  toast: null,
  focusMode: false,
  setFocusMode: (focusMode) => {
    set({ focusMode });
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(focusMode)).catch(() => {});
  },

  openWorld: async (world) => {
    const [types, entries, projects, calendar] = await Promise.all([
      api.listTypes(),
      api.listEntries(),
      api.listProjects(),
      api.getCalendar(),
    ]);
    const [pinnedRaw, cover, dictionaryRaw] = await Promise.all([
      api.getWorldSetting("pinned"),
      api.getWorldSetting("cover"),
      api.getWorldSetting("dictionary"),
    ]);
    const list = (raw: string | null): string[] => {
      try {
        const v = JSON.parse(raw ?? "[]");
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    };
    const pinned = list(pinnedRaw);
    const dictionary = list(dictionaryRaw);
    set({
      world,
      types,
      entries,
      projects,
      calendar: calendar ?? EMPTY_CALENDAR,
      pinned,
      cover,
      dictionary,
      route: { view: "dashboard" },
      back: [],
      forward: [],
    });
  },
  closeWorld: async () => {
    await backupOnClose();
    await api.closeWorld();
    set({ world: null, types: [], entries: [], projects: [], back: [], forward: [] });
  },
  setWorld: (world) => set({ world }),
  togglePin: async (id) => {
    const { pinned } = get();
    const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    set({ pinned: next });
    await api.setWorldSetting("pinned", JSON.stringify(next));
  },
  learnWord: async (word) => {
    const w = word.replace(/[’‘]/g, "'").trim();
    const { dictionary } = get();
    if (!w || dictionary.includes(w)) return;
    const next = [...dictionary, w].sort((a, b) => a.localeCompare(b));
    set({ dictionary: next });
    await api.setWorldSetting("dictionary", JSON.stringify(next));
  },
  forgetWord: async (word) => {
    const next = get().dictionary.filter((w) => w !== word);
    set({ dictionary: next });
    await api.setWorldSetting("dictionary", JSON.stringify(next));
  },
  setCover: async (cover) => {
    set({ cover });
    await api.setWorldSetting("cover", cover);
  },
  setCalendar: async (calendar) => {
    set({ calendar });
    await api.saveCalendar(calendar);
  },
  refreshTypes: async () => set({ types: await api.listTypes() }),
  refreshEntries: async () => set({ entries: await api.listEntries() }),
  refreshProjects: async () => set({ projects: await api.listProjects() }),
  patchEntry: (summary) =>
    set(({ entries }) => {
      const rest = entries.filter((e) => e.id !== summary.id);
      return { entries: [...rest, summary].sort((a, b) => a.title.localeCompare(b.title)) };
    }),
  removeEntry: (id) => set(({ entries }) => ({ entries: entries.filter((e) => e.id !== id) })),

  go: (route) => {
    const { route: current, back } = get();
    if (route.view !== "project" && get().focusMode) get().setFocusMode(false);
    if (sameRoute(current, route)) return;
    set({ route, back: [...back, current].slice(-100), forward: [] });
  },
  goBack: () => {
    const { back, route, forward } = get();
    const prev = back[back.length - 1];
    if (prev) set({ route: prev, back: back.slice(0, -1), forward: [route, ...forward] });
  },
  goForward: () => {
    const { back, route, forward } = get();
    const next = forward[0];
    if (next) set({ route: next, back: [...back, route], forward: forward.slice(1) });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  notify: (toast) => {
    set({ toast });
    setTimeout(() => get().toast === toast && set({ toast: null }), 4000);
  },
}));

export const typeById = (id: string) => useStore.getState().types.find((t) => t.id === id);
