import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";

type Status =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current" }
  | { state: "available"; update: Update }
  | { state: "downloading"; update: Update; percent: number }
  | { state: "error"; message: string };

interface UpdaterState {
  status: Status;
  /** The full-screen prompt; "Later" closes it and leaves the banner. */
  promptOpen: boolean;
  bannerDismissed: boolean;
  checkNow: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
  later: () => void;
  dismissBanner: () => void;
}

/** Remembered across the restart so the new version can show what changed. */
export const UPDATED_FROM_KEY = "eardloom.updatedFrom";

/**
 * Talks to the GitHub Releases feed configured in tauri.conf.json. Updates are
 * signature-checked against the public key baked into the app before installing.
 */
export const useUpdater = create<UpdaterState>((set, get) => ({
  status: { state: "idle" },
  promptOpen: false,
  bannerDismissed: false,
  checkNow: async (silent = false) => {
    const before = get().status;
    if (before.state === "downloading") return;
    set({ status: { state: "checking" } });
    try {
      const update = await check();
      if (!update) return set({ status: { state: "current" } });
      // Only interrupt with the prompt once per version per session.
      const seen = before.state === "available" && before.update.version === update.version;
      set({ status: { state: "available", update }, promptOpen: !seen || get().promptOpen, bannerDismissed: false });
    } catch (e) {
      // Offline, or no release published yet: stay quiet on automatic checks.
      set({ status: silent ? before.state === "checking" ? { state: "idle" } : before : { state: "error", message: String(e) } });
    }
  },
  install: async () => {
    const { status } = get();
    if (status.state !== "available") return;
    const update = status.update;
    let total = 0;
    let done = 0;
    set({ status: { state: "downloading", update, percent: 0 }, promptOpen: true });
    try {
      try {
        localStorage.setItem(UPDATED_FROM_KEY, await getVersion());
      } catch {
        /* What's New just won't show */
      }
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          set({ status: { state: "downloading", update, percent: total ? Math.round((done / total) * 100) : 0 } });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: { state: "error", message: String(e) } });
    }
  },
  later: () => set({ promptOpen: false }),
  dismissBanner: () => set({ bannerDismissed: true }),
}));

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Check on launch, then periodically for people who leave the app open. */
export function startUpdateChecks() {
  const run = () => useUpdater.getState().checkNow(true);
  run();
  const timer = window.setInterval(run, SIX_HOURS);
  return () => window.clearInterval(timer);
}
