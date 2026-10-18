import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";

type Status =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current" }
  | { state: "available"; update: Update }
  | { state: "downloading"; percent: number }
  | { state: "error"; message: string };

interface UpdaterState {
  status: Status;
  dismissed: boolean;
  checkNow: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Talks to the GitHub Releases feed configured in tauri.conf.json. Updates are
 * signature-checked against the public key baked into the app before installing.
 */
export const useUpdater = create<UpdaterState>((set, get) => ({
  status: { state: "idle" },
  dismissed: false,
  checkNow: async (silent = false) => {
    set({ status: { state: "checking" } });
    try {
      const update = await check();
      set({ status: update ? { state: "available", update } : { state: "current" }, dismissed: false });
    } catch (e) {
      // Offline, or no release published yet: stay quiet on the automatic startup check.
      set({ status: silent ? { state: "idle" } : { state: "error", message: String(e) } });
    }
  },
  install: async () => {
    const { status } = get();
    if (status.state !== "available") return;
    let total = 0;
    let done = 0;
    try {
      await status.update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          set({ status: { state: "downloading", percent: total ? Math.round((done / total) * 100) : 0 } });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: { state: "error", message: String(e) } });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));
