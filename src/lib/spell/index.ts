import { create } from "zustand";
import type { SpellRequest, SpellResponse } from "./worker";

export type SpellLang = "en-GB" | "en-US" | "off";

const LANG_KEY = "eardloom.spelling";

export function getSpellLang(): SpellLang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en-GB" || v === "en-US" || v === "off") return v;
  } catch {
    /* default below */
  }
  return "en-GB";
}

/** Bumped whenever results could change (dictionary loaded, word learned...), so editors recheck. */
export const useSpellVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let lang: SpellLang = getSpellLang();
let known: string[] = [];
let nextId = 1;
const pending = new Map<number, (r: SpellResponse) => void>();
/** Session-only "Ignore" list. */
const ignored = new Set<string>();
/** Results already looked up: word -> correct? */
const cache = new Map<string, boolean>();

function start() {
  if (lang === "off") return null;
  if (ready) return ready;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  ready = new Promise<void>((resolve) => {
    worker!.onmessage = (e: MessageEvent<SpellResponse>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        resolve();
        useSpellVersion.getState().bump();
      } else pending.get(msg.id)?.(msg), pending.delete(msg.id);
    };
  });
  post({ type: "init", lang, known });
  return ready;
}

function post(msg: SpellRequest) {
  worker?.postMessage(msg);
}

/** Omit that distributes over a union, so each request keeps its own fields. */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function request<T extends SpellResponse>(msg: WithoutId<Extract<SpellRequest, { id: number }>>): Promise<T> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve as (r: SpellResponse) => void);
    post({ ...msg, id } as SpellRequest);
  });
}

/** Normalise for lookup: curly apostrophes, trailing possessive quotes. */
export const normalise = (w: string) => w.replace(/[’‘]/g, "'").replace(/^'+|'+$/g, "");

/** Which of these words are misspelt. Uses a cache, so repeated checks are cheap. */
export async function misspelt(words: string[]): Promise<Set<string>> {
  if (lang === "off") return new Set();
  const r = start();
  if (r) await r;
  const unknown = [...new Set(words.map(normalise))].filter((w) => w && !cache.has(w));
  if (unknown.length) {
    const res = await request<Extract<SpellResponse, { type: "checked" }>>({ type: "check", words: unknown });
    const wrong = new Set(res.wrong);
    for (const w of unknown) cache.set(w, !wrong.has(w));
  }
  return new Set(words.filter((w) => {
    const n = normalise(w);
    return cache.get(n) === false && !ignored.has(n.toLowerCase());
  }));
}

export async function suggestions(word: string): Promise<string[]> {
  if (lang === "off" || !start()) return [];
  await ready;
  const res = await request<Extract<SpellResponse, { type: "suggested" }>>({ type: "suggest", word: normalise(word) });
  return res.suggestions;
}

/** Words that are always correct in this world: learned words and entry names. */
export function setKnownWords(words: string[]) {
  known = words;
  cache.clear();
  post({ type: "known", words });
  useSpellVersion.getState().bump();
}

export function ignoreWord(word: string) {
  ignored.add(normalise(word).toLowerCase());
  useSpellVersion.getState().bump();
}

export function setSpellLang(next: SpellLang) {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    /* preference just won't persist */
  }
  lang = next;
  worker?.terminate();
  worker = null;
  ready = null;
  cache.clear();
  pending.clear();
  if (next !== "off") start();
  useSpellVersion.getState().bump();
}

export const spellingOn = () => lang !== "off";
