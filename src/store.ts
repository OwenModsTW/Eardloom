import { create } from "zustand";
import { api } from "./lib/api";
import type { EntrySummary, EntryType, Project, WorldInfo } from "./lib/types";

export type Route =
  | { view: "dashboard" }
  | { view: "type"; typeId: string }
  | { view: "entry"; id: string }
  | { view: "project"; id: string; docId?: string }
  | { view: "schema"; typeId?: string }
  | { view: "settings" };

interface State {
  world: WorldInfo | null;
  types: EntryType[];
  entries: EntrySummary[];
  projects: Project[];

  route: Route;
  back: Route[];
  forward: Route[];
  paletteOpen: boolean;
  toast: string | null;

  openWorld: (world: WorldInfo) => Promise<void>;
  closeWorld: () => Promise<void>;
  setWorld: (world: WorldInfo) => void;
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
  route: { view: "dashboard" },
  back: [],
  forward: [],
  paletteOpen: false,
  toast: null,

  openWorld: async (world) => {
    const [types, entries, projects] = await Promise.all([api.listTypes(), api.listEntries(), api.listProjects()]);
    set({ world, types, entries, projects, route: { view: "dashboard" }, back: [], forward: [] });
  },
  closeWorld: async () => {
    await api.closeWorld();
    set({ world: null, types: [], entries: [], projects: [], back: [], forward: [] });
  },
  setWorld: (world) => set({ world }),
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
