import { create } from "zustand";
import { api } from "./lib/api";
import type { Calendar, EntrySummary, EntryType, Project, WorldInfo } from "./lib/types";
import { EMPTY_CALENDAR } from "./lib/calendar";

export type Route =
  | { view: "dashboard" }
  | { view: "type"; typeId: string }
  | { view: "entry"; id: string }
  | { view: "project"; id: string; docId?: string }
  | { view: "schema"; typeId?: string }
  | { view: "settings" }
  | { view: "timeline" }
  | { view: "calendar" };

interface State {
  world: WorldInfo | null;
  types: EntryType[];
  entries: EntrySummary[];
  projects: Project[];
  calendar: Calendar;
  /** Entries pinned to the world's home page. */
  pinned: string[];
  cover: string | null;

  route: Route;
  back: Route[];
  forward: Route[];
  paletteOpen: boolean;
  toast: string | null;

  openWorld: (world: WorldInfo) => Promise<void>;
  closeWorld: () => Promise<void>;
  setWorld: (world: WorldInfo) => void;
  setCalendar: (calendar: Calendar) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
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
  route: { view: "dashboard" },
  back: [],
  forward: [],
  paletteOpen: false,
  toast: null,

  openWorld: async (world) => {
    const [types, entries, projects, calendar] = await Promise.all([
      api.listTypes(),
      api.listEntries(),
      api.listProjects(),
      api.getCalendar(),
    ]);
    const [pinnedRaw, cover] = await Promise.all([api.getWorldSetting("pinned"), api.getWorldSetting("cover")]);
    let pinned: string[] = [];
    try {
      pinned = JSON.parse(pinnedRaw ?? "[]");
    } catch {
      /* start fresh */
    }
    set({
      world,
      types,
      entries,
      projects,
      calendar: calendar ?? EMPTY_CALENDAR,
      pinned,
      cover,
      route: { view: "dashboard" },
      back: [],
      forward: [],
    });
  },
  closeWorld: async () => {
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
