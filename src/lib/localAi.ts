import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

export interface ModelInfo {
  id: "small" | "standard" | "large";
  label: string;
  bytes: number;
  vramMb: number;
  installed: boolean;
}

export interface LocalAiStatus {
  engineInstalled: boolean;
  engineBytes: number;
  models: ModelInfo[];
  runningModel: string | null;
  downloading: boolean;
  diskUsed: number;
}

const PREFS = "eardloom.localAi";

interface Prefs {
  /** Off until the author turns it on. */
  enabled: boolean;
  model: ModelInfo["id"];
  /** Let the model reason before answering: slower, sometimes better. */
  thinking: boolean;
}

const DEFAULTS: Prefs = { enabled: false, model: "standard", thinking: false };

function readPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

interface LocalAiState extends Prefs {
  panelOpen: boolean;
  setPrefs: (patch: Partial<Prefs>) => void;
  setPanel: (open: boolean) => void;
}

export const useLocalAi = create<LocalAiState>((set, get) => ({
  ...readPrefs(),
  panelOpen: false,
  setPrefs: (patch) => {
    const next = { enabled: get().enabled, model: get().model, thinking: get().thinking, ...patch };
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      /* preference just won't persist */
    }
    set(next);
    // Turning it off stops the engine straight away.
    if (patch.enabled === false) {
      set({ panelOpen: false });
      void invoke("local_ai_stop");
    }
  },
  setPanel: (panelOpen) => set({ panelOpen }),
}));

export const localAi = {
  status: () => invoke<LocalAiStatus>("local_ai_status"),
  hardware: () => invoke<[string, number][]>("local_ai_hardware"),
  install: (model: string) => invoke<void>("local_ai_install", { model }),
  cancelDownload: () => invoke<void>("local_ai_cancel_download"),
  remove: (model: string | null, everything: boolean) => invoke<void>("local_ai_remove", { model, everything }),
  start: (model: string) => invoke<void>("local_ai_start", { model }),
  stop: () => invoke<void>("local_ai_stop"),
};

/** The biggest model this computer's graphics memory runs comfortably. */
export function recommend(models: ModelInfo[], vramMb: number): ModelInfo["id"] {
  const fits = models.filter((m) => m.vramMb <= vramMb + 500);
  return (fits[fits.length - 1]?.id ?? "small") as ModelInfo["id"];
}

export const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;
