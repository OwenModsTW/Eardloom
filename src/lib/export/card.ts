import { api } from "../api";
import { useStore } from "../../store";
import { toParagraphs } from "../text";
import type { Entry, EntryType, FieldValue, WorldDate } from "../types";
import { formatDate } from "../calendar";

export type CardLayout = "portrait" | "banner";
export type CardTheme = "dark" | "light";

export interface CardOptions {
  layout: CardLayout;
  theme: CardTheme;
  fieldIds: string[];
  showSummary: boolean;
  showWorld: boolean;
}

const SIZES: Record<CardLayout, [number, number]> = { portrait: [1080, 1350], banner: [1600, 900] };

const PALETTES = {
  dark: { bg: "#111b1a", panel: "#162321", line: "#2d4540", text: "#ece6d5", soft: "#bcb5a3", muted: "#7c8a85", accent: "#f6bd60" },
  light: { bg: "#f4f0e6", panel: "#fbf9f3", line: "#d6d0bd", text: "#1b2826", soft: "#43514c", muted: "#737a70", accent: "#a86f12" },
};

const SERIF = '"Literata Variable", Georgia, serif';
const SANS = '"Source Sans 3 Variable", "Segoe UI", sans-serif';
const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", sans-serif';

/** A field's value as display text, or null if it's empty. */
export function fieldText(value: FieldValue | undefined, kind: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const entries = useStore.getState().entries;
  if (kind === "entry" || kind === "entries") {
    const ids = Array.isArray(value) ? value : [String(value)];
    const names = ids.map((id) => entries.find((e) => e.id === id)?.title).filter(Boolean);
    return names.length ? names.join(", ") : null;
  }
  if (kind === "worlddate") return formatDate(useStore.getState().calendar, value as WorldDate) || null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "object") return toParagraphs(value).join(" ") || null;
  return String(value);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

async function entryImage(file: string | null) {
  if (!file) return null;
  try {
    // A blob URL keeps the canvas untainted, so it can still be exported.
    const url = URL.createObjectURL(new Blob([await api.readAsset(file)]));
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/** Wraps text into lines that fit `width`, truncating with an ellipsis after `max` lines. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= width || !line) line = test;
    else {
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    }
  }
  if (lines.length < max && line) lines.push(line);
  const used = lines.join(" ").split(" ").length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Draws `img` to fill the box, cropping the overflow (like CSS object-fit: cover). */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** Image, else emoji on a tinted field, else a tinted field with the category initial. */
function drawArt(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  entry: Entry,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (img) return cover(ctx, img, x, y, w, h);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, `${color}55`);
  g.addColorStop(1, `${color}14`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (entry.emoji) {
    ctx.font = `${Math.min(w, h) * 0.42}px ${EMOJI}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entry.emoji, x + w / 2, y + h / 2 + Math.min(w, h) * 0.03);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

export async function renderCard(entry: Entry, type: EntryType | undefined, opts: CardOptions): Promise<HTMLCanvasElement> {
  await Promise.all([
    document.fonts.load(`600 40px ${SERIF}`),
    document.fonts.load(`italic 30px ${SERIF}`),
    document.fonts.load(`600 24px ${SANS}`),
    document.fonts.load(`24px ${SANS}`),
  ]);
  const [W, H] = SIZES[opts.layout];
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const p = PALETTES[opts.theme];
  const color = type?.color ?? p.accent;
  const world = useStore.getState().world?.name ?? "";
  const [img, logo] = await Promise.all([entryImage(entry.image), loadImage("/logo.png").catch(() => null)]);

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  const fields = (type?.fields ?? [])
    .filter((f) => opts.fieldIds.includes(f.id))
    .map((f) => [f.label, fieldText(entry.fields[f.id], f.kind)] as const)
    .filter((x): x is readonly [string, string] => !!x[1]);

  // Text column geometry depends on the layout.
  let tx: number, ty: number, tw: number, bottom: number;
  if (opts.layout === "portrait") {
    const artH = 560;
    drawArt(ctx, img, entry, color, 0, 0, W, artH);
    const fade = ctx.createLinearGradient(0, artH - 180, 0, artH);
    fade.addColorStop(0, `${p.bg}00`);
    fade.addColorStop(1, p.bg);
    ctx.fillStyle = fade;
    ctx.fillRect(0, artH - 180, W, 180);
    tx = 80;
    ty = artH + 20;
    tw = W - 160;
    bottom = H - 120;
  } else {
    const artW = 640;
    drawArt(ctx, img, entry, color, 0, 0, artW, H);
    ctx.fillStyle = color;
    ctx.fillRect(artW, 0, 6, H);
    tx = artW + 80;
    ty = 110;
    tw = W - artW - 150;
    bottom = H - 110;
  }

  // Category label
  ctx.fillStyle = color;
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText((type?.name ?? "Entry").toUpperCase().split("").join(" "), tx, ty);
  ty += 22;

  // Title
  ctx.fillStyle = p.text;
  const titleSize = opts.layout === "portrait" ? 76 : 68;
  ctx.font = `600 ${titleSize}px ${SERIF}`;
  for (const line of wrap(ctx, entry.title || "Unnamed", tw, 2)) {
    ty += titleSize * 1.12;
    ctx.fillText(line, tx, ty);
  }

  if (entry.aliases.length) {
    ty += 46;
    ctx.fillStyle = p.muted;
    ctx.font = `italic 28px ${SERIF}`;
    ctx.fillText(wrap(ctx, `also ${entry.aliases.join(", ")}`, tw, 1)[0] ?? "", tx, ty);
  }

  if (opts.showSummary && entry.summary.trim()) {
    ctx.fillStyle = p.soft;
    ctx.font = `italic 34px ${SERIF}`;
    ty += 30;
    for (const line of wrap(ctx, entry.summary, tw, 3)) {
      ty += 48;
      ctx.fillText(line, tx, ty);
    }
  }

  // Field table, as many rows as fit.
  if (fields.length) {
    ty += 46;
    const labelW = Math.min(300, tw * 0.36);
    for (const [label, value] of fields) {
      ctx.font = `26px ${SANS}`;
      const lines = wrap(ctx, value, tw - labelW, 2);
      const rowH = 26 + lines.length * 36;
      if (ty + rowH > bottom) break;
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + tw, ty);
      ctx.stroke();
      ctx.fillStyle = p.muted;
      ctx.font = `600 24px ${SANS}`;
      ctx.fillText(wrap(ctx, label, labelW - 20, 1)[0] ?? "", tx, ty + 44);
      ctx.fillStyle = p.text;
      ctx.font = `28px ${SANS}`;
      lines.forEach((l, i) => ctx.fillText(l, tx + labelW, ty + 44 + i * 36));
      ty += rowH;
    }
  }

  // Footer: world name on the left, a small maker's mark on the right.
  const fy = H - 56;
  ctx.font = `600 24px ${SANS}`;
  if (opts.showWorld && world) {
    ctx.fillStyle = p.muted;
    ctx.fillText(wrap(ctx, world, W / 2, 1)[0] ?? "", opts.layout === "portrait" ? 80 : tx, fy);
  }
  if (logo) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(logo, W - 80 - 34, fy - 27, 34, 34);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = p.muted;
  ctx.font = `22px ${SANS}`;
  ctx.textAlign = "right";
  ctx.fillText("Eardloom", W - 80 - 46, fy);
  ctx.textAlign = "left";

  return c;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't render image"))), "image/png"));
}

const CARD_PREFS = "eardloom.card";

/** The card settings last used in the share dialog (layout, theme, what to show). */
export function savedCardPrefs(): Partial<CardOptions> {
  try {
    return JSON.parse(localStorage.getItem(CARD_PREFS) ?? "{}");
  } catch {
    return {};
  }
}

export function saveCardPrefs(prefs: Partial<CardOptions>) {
  try {
    localStorage.setItem(CARD_PREFS, JSON.stringify(prefs));
  } catch {
    /* preference only */
  }
}

/** The first few short fields that have something in them: what a card shows by default. */
export function defaultCardFields(entry: Entry, type: EntryType | undefined) {
  return (type?.fields ?? []).filter((f) => f.kind !== "longtext" && fieldText(entry.fields[f.id], f.kind)).slice(0, 6).map((f) => f.id);
}

/** Copies an entry's card to the clipboard as a picture, with the last-used settings. */
export async function copyCard(entry: Entry, type: EntryType | undefined) {
  const p = savedCardPrefs();
  const canvas = await renderCard(entry, type, {
    layout: p.layout ?? "portrait",
    theme: p.theme ?? "dark",
    showSummary: p.showSummary ?? true,
    showWorld: p.showWorld ?? true,
    fieldIds: defaultCardFields(entry, type),
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": canvasToPng(canvas) })]);
}
