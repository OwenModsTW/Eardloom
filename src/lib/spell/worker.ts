/// <reference lib="webworker" />
import nspell from "nspell";
import gbAff from "../../../node_modules/dictionary-en-gb/index.aff?raw";
import gbDic from "../../../node_modules/dictionary-en-gb/index.dic?raw";
import usAff from "../../../node_modules/dictionary-en/index.aff?raw";
import usDic from "../../../node_modules/dictionary-en/index.dic?raw";

export type SpellRequest =
  | { type: "init"; lang: "en-GB" | "en-US"; known: string[] }
  | { type: "known"; words: string[] }
  | { type: "check"; id: number; words: string[] }
  | { type: "suggest"; id: number; word: string };

export type SpellResponse =
  | { type: "ready" }
  | { type: "checked"; id: number; wrong: string[] }
  | { type: "suggested"; id: number; suggestions: string[] };

let speller: ReturnType<typeof nspell> | null = null;
/** Words the person has taught us, plus every entry name in the world. */
let known = new Set<string>();

const post = (msg: SpellResponse) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

const isKnown = (word: string) => known.has(word) || known.has(word.toLowerCase());

self.onmessage = (e: MessageEvent<SpellRequest>) => {
  const msg = e.data;
  if (msg.type === "init") {
    speller = msg.lang === "en-US" ? nspell(usAff, usDic) : nspell(gbAff, gbDic);
    known = new Set(msg.known);
    post({ type: "ready" });
  } else if (msg.type === "known") {
    known = new Set(msg.words);
  } else if (msg.type === "check") {
    const wrong = speller ? msg.words.filter((w) => !isKnown(w) && !speller!.correct(w)) : [];
    post({ type: "checked", id: msg.id, wrong });
  } else if (msg.type === "suggest") {
    post({ type: "suggested", id: msg.id, suggestions: speller ? speller.suggest(msg.word).slice(0, 6) : [] });
  }
};
