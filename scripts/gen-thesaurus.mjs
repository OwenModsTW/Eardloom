// Builds the thesaurus Eardloom ships (public/thesaurus.json, fetched the first time it's
// used) from WordNet 3.1. Each meaning of a word becomes a "sense": part of speech, a short
// definition, synonyms, related words (similar adjectives, or the broader term for nouns and
// verbs) and opposites. Runs before every build; --if-missing skips it when the file exists.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const out = join(root, "public", "thesaurus.json");
if (process.argv.includes("--if-missing") && existsSync(out)) process.exit(0);

const require = createRequire(import.meta.url);
const dict = join(dirname(require.resolve("wordnet-db/package.json")), "dict");

/** Part of speech as stored: n, v, a (adjectives, including satellites) or r (adverbs). */
const POS = { n: "n", v: "v", a: "a", s: "a", r: "r" };
const FILES = { n: "noun", v: "verb", a: "adj", r: "adv" };
const fileOf = (pos) => (pos === "s" ? "a" : pos);
const clean = (w) => w.replace(/\(\w+\)$/, "").replace(/_/g, " ");

// ---- every synset: words, pointers and definition
const synsets = new Map(); // "a:00001740" -> { pos, words, ptrs, gloss }
for (const [p, name] of Object.entries(FILES)) {
  for (const line of readFileSync(join(dict, `data.${name}`), "utf8").split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const [head, gloss = ""] = line.split(" | ");
    const f = head.trim().split(" ");
    const count = parseInt(f[3], 16);
    const words = [];
    for (let i = 0; i < count; i++) words.push(clean(f[4 + i * 2]));
    let k = 4 + count * 2;
    const nPtr = parseInt(f[k++], 10);
    const ptrs = [];
    for (let i = 0; i < nPtr; i++, k += 4) ptrs.push({ sym: f[k], key: `${fileOf(f[k + 2])}:${f[k + 1]}`, st: f[k + 3] });
    // The definition, without the example sentences that follow it.
    let def = gloss.split(/;\s*"/)[0].split("; ")[0].trim();
    if (def.length > 90) def = def.slice(0, 87).replace(/\s+\S*$/, "") + "…";
    synsets.set(`${p}:${f[0]}`, { pos: f[2], words, ptrs, gloss: def });
  }
}

// ---- senses: one per synset, built when first needed
const senses = [];
const senseOf = new Map();
function sense(key) {
  if (senseOf.has(key)) return senseOf.get(key);
  const s = synsets.get(key);
  const related = new Set();
  const opposite = new Set();
  for (const ptr of s.ptrs) {
    const t = synsets.get(ptr.key);
    if (!t) continue;
    if (ptr.sym === "&") t.words.forEach((w) => related.add(w)); // similar adjectives
    if (ptr.sym === "@" && related.size < 6) t.words.slice(0, 4).forEach((w) => related.add(w)); // broader term
    if (ptr.sym === "!") {
      const target = parseInt(ptr.st.slice(2), 16);
      opposite.add(target ? t.words[target - 1] : t.words[0]);
    }
  }
  s.words.forEach((w) => related.delete(w));
  const id = senses.length;
  senses.push([POS[s.pos], s.gloss, s.words.join("|"), [...related].slice(0, 12).join("|"), [...opposite].join("|")]);
  senseOf.set(key, id);
  return id;
}

// ---- index: each single word's meanings. Within a part of speech WordNet lists the most
// common first; parts of speech are ordered by how often the word is used that way.
const groups = new Map(); // lemma -> [{ tagged, ids }]
for (const [p, name] of Object.entries(FILES)) {
  for (const line of readFileSync(join(dict, `index.${name}`), "utf8").split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const f = line.trim().split(" ");
    const lemma = f[0];
    if (lemma.includes("_") || !/^[a-z][a-z'-]*$/.test(lemma)) continue;
    const nSyn = parseInt(f[2], 10);
    const nPtr = parseInt(f[3], 10);
    const offsets = f.slice(4 + nPtr + 2, 4 + nPtr + 2 + nSyn);
    const ids = offsets.map((o) => sense(`${p}:${o}`)).filter((id) => {
      const [, , words, related] = senses[id];
      return words.includes("|") || related; // a meaning with nothing else to offer is left out
    });
    // How many times this word was seen used as this part of speech in WordNet's tagged texts.
    const tagged = parseInt(f[4 + nPtr + 1], 10) || 0;
    if (ids.length) {
      if (!groups.has(lemma)) groups.set(lemma, []);
      groups.get(lemma).push({ p, tagged, ids });
    }
  }
}
const index = Object.create(null); // plain table: words like "constructor" are real words here
// How common each word is as a noun, verb, adjective and adverb ("n,v,a,r"), so "running" can
// lead with the verb "run" while "evening" leads with the noun.
const usage = Object.create(null);
for (const [lemma, g] of groups) {
  index[lemma] = g.sort((a, b) => b.tagged - a.tagged).flatMap((x) => x.ids);
  if (g.some((x) => x.tagged)) usage[lemma] = ["n", "v", "a", "r"].map((p) => g.find((x) => x.p === p)?.tagged ?? 0).join(",");
}

const json = JSON.stringify({ s: senses, i: index, u: usage });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, json);
console.log(`Thesaurus: ${Object.keys(index).length} words, ${senses.length} meanings, ${(json.length / 1e6).toFixed(1)} MB`);
