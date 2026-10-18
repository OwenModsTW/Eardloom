export type Theme = "dark" | "light" | "system";

/** Accent presets drawn from the logo, each tuned for legibility in both themes. */
export const ACCENTS = {
  sun: { label: "Sun", dark: "#f6bd60", light: "#a86f12" },
  meadow: { label: "Meadow", dark: "#5cbf98", light: "#1f7a5f" },
  teal: { label: "Deep teal", dark: "#6bbfb2", light: "#135e55" },
  ember: { label: "Ember", dark: "#ec8d6c", light: "#b0502f" },
  dusk: { label: "Dusk", dark: "#b49be6", light: "#6a4fb0" },
} as const;

export type AccentPreset = keyof typeof ACCENTS;

export interface Appearance {
  theme: Theme;
  /** A preset name, or a custom "#rrggbb" colour used in both themes. */
  accent: AccentPreset | string;
}

const KEY = "eardloom.appearance";
const DEFAULTS: Appearance = { theme: "dark", accent: "sun" };

export function getAppearance(): Appearance {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/** Dark text on light accents, light text on dark ones. */
function inkFor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? "#1d1505" : "#fffaf0";
}

export function applyAppearance(a: Appearance = getAppearance()) {
  const mode =
    a.theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : a.theme;
  const root = document.documentElement;
  root.dataset.theme = mode;
  const preset = ACCENTS[a.accent as AccentPreset];
  const accent = preset ? preset[mode] : /^#[0-9a-f]{6}$/i.test(a.accent) ? a.accent : ACCENTS.sun[mode];
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-ink", inkFor(accent));
}

export function setAppearance(patch: Partial<Appearance>) {
  const next = { ...getAppearance(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* preference just won't persist */
  }
  applyAppearance(next);
  return next;
}

/** Keep "Match Windows" in sync when the OS theme flips. */
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (getAppearance().theme === "system") applyAppearance();
});
