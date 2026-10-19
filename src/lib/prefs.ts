/** Small per-computer preferences that aren't part of any world. */
const AUTHOR = "eardloom.author";

export function getDefaultAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR) ?? "";
  } catch {
    return "";
  }
}

export function setDefaultAuthor(name: string) {
  try {
    localStorage.setItem(AUTHOR, name);
  } catch {
    /* preference just won't persist */
  }
}

/** How manuscripts look on screen. Purely visual: exports use their own typography. */
export interface ManuscriptLook {
  font: "literata" | "georgia" | "palatino" | "sans" | "mono";
  size: number;
  lineHeight: number;
  width: number;
  /** Novel style: first-line indents and no gap between paragraphs. */
  indent: boolean;
  typewriter: boolean;
  dimOthers: boolean;
  /** Show the chapter as pages of paper, with page breaks marked. */
  pageView: boolean;
}

export const FONTS: Record<ManuscriptLook["font"], { label: string; css: string }> = {
  literata: { label: "Literata", css: '"Literata Variable", Georgia, serif' },
  georgia: { label: "Georgia", css: "Georgia, serif" },
  palatino: { label: "Palatino", css: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  sans: { label: "Source Sans", css: '"Source Sans 3 Variable", "Segoe UI", sans-serif' },
  mono: { label: "Typewriter", css: '"Courier New", Courier, monospace' },
};

const LOOK = "eardloom.manuscript";
const LOOK_DEFAULTS: ManuscriptLook = { font: "literata", size: 18, lineHeight: 1.8, width: 700, indent: false, typewriter: false, dimOthers: false, pageView: false };

export function getManuscriptLook(): ManuscriptLook {
  try {
    return { ...LOOK_DEFAULTS, ...JSON.parse(localStorage.getItem(LOOK) ?? "{}") };
  } catch {
    return LOOK_DEFAULTS;
  }
}

export function applyManuscriptLook(look: ManuscriptLook = getManuscriptLook()) {
  const s = document.documentElement.style;
  s.setProperty("--ms-font", FONTS[look.font]?.css ?? FONTS.literata.css);
  s.setProperty("--ms-size", `${look.size}px`);
  s.setProperty("--ms-line", String(look.lineHeight));
  s.setProperty("--ms-width", `${look.width}px`);
  document.documentElement.classList.toggle("ms-indent", look.indent);
  document.documentElement.classList.toggle("ms-dim", look.dimOthers);
  document.documentElement.classList.toggle("ms-pages", look.pageView);
}

export function setManuscriptLook(patch: Partial<ManuscriptLook>) {
  const next = { ...getManuscriptLook(), ...patch };
  try {
    localStorage.setItem(LOOK, JSON.stringify(next));
  } catch {
    /* preference just won't persist */
  }
  applyManuscriptLook(next);
  window.dispatchEvent(new CustomEvent("eardloom:look", { detail: next }));
  return next;
}
