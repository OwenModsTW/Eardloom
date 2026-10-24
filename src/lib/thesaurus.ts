// The thesaurus: alternatives for a word, grouped by meaning, from WordNet (built into the app
// and loaded the first time it's used). Handles word forms both ways: "running" is looked up
// as "run", and choosing "sprint" puts it back as "sprinting".

export type PartOfSpeech = "n" | "v" | "a" | "r";

/** How a word was changed from its dictionary form. */
export type Form = "" | "plural" | "s" | "ed" | "past" | "pp" | "ing" | "er" | "est";

/** One meaning of the word looked up. */
export interface Sense {
  pos: PartOfSpeech;
  /** The dictionary form this meaning belongs to ("run" for "running") and how the text changed it. */
  base: string;
  form: Form;
  /** A short definition, to tell meanings apart. */
  gloss: string;
  synonyms: string[];
  /** Similar words (adjectives) or the broader term (nouns, verbs). */
  related: string[];
  opposites: string[];
}

type Raw = {
  s: [PartOfSpeech, string, string, string, string][];
  i: Record<string, number[]>;
  /** How often each word is used as a noun, verb, adjective and adverb: "n,v,a,r". */
  u: Record<string, string>;
};
let data: Promise<Raw> | null = null;
let loaded: Raw | null = null;

/** Loads the thesaurus (once). */
export function loadThesaurus() {
  return (data ??= fetch("/thesaurus.json").then(async (r) => {
    if (!r.ok) throw new Error("The thesaurus couldn't be loaded.");
    return (loaded = (await r.json()) as Raw);
  }));
}

/** How commonly a single word is used in everyday English (0 for phrases and rare words). */
export function commonness(word: string): number {
  const w = word.toLowerCase();
  if (!loaded || w.includes(" ") || !Object.prototype.hasOwnProperty.call(loaded.u, w)) return 0;
  return loaded.u[w].split(",").reduce((n, c) => n + Number(c), 0);
}

/** Everyday words first; phrases after single words. */
export const byCommonness = (a: string, b: string) => commonness(b) - commonness(a) || a.split(" ").length - b.split(" ").length;

/** Broader terms too general to offer as an alternative ("run" is a kind of "be"). */
const TOO_GENERAL = new Set(["be", "have", "do", "act", "move", "change", "make", "get", "entity", "object", "abstraction", "physical entity", "thing", "matter", "relation", "attribute", "state", "event", "group", "person", "individual", "someone", "somebody"]);

/**
 * The best few alternatives across a word's meanings, for a quick menu: the most common word
 * from each meaning in turn, broader words where a meaning has no synonyms, each already in the
 * same form and capitalisation as the word it replaces.
 */
export function topAlternatives(word: string, senses: Sense[], max = 7) {
  const seen = new Set<string>([word.toLowerCase(), ...senses.map((s) => s.base)]);
  const pools = senses.map((s) => {
    const words = s.synonyms.length ? [...s.synonyms, ...(s.pos === "a" ? s.related : [])] : s.related.filter((w) => !TOO_GENERAL.has(w));
    return [...words].sort(byCommonness).map((w) => ({ text: fitReplacement(word, w, s.form, s.pos), gloss: s.gloss }));
  });
  const out: { text: string; gloss: string }[] = [];
  const take = (pool: (typeof pools)[number]) => {
    for (let next = pool.shift(); next; next = pool.shift()) {
      if (seen.has(next.text.toLowerCase())) continue;
      seen.add(next.text.toLowerCase());
      out.push(next);
      return;
    }
  };
  // The most common meaning is usually the one meant, so it offers two to start with.
  if (pools[0]) take(pools[0]);
  while (out.length < max && pools.some((p) => p.length)) for (const pool of pools) if (out.length < max) take(pool);
  return out;
}

// ---- irregular forms
// [base, past, past participle]
const VERBS: [string, string, string][] = [
  ["arise", "arose", "arisen"], ["awake", "awoke", "awoken"], ["be", "was", "been"], ["bear", "bore", "borne"], ["beat", "beat", "beaten"],
  ["become", "became", "become"], ["begin", "began", "begun"], ["bend", "bent", "bent"], ["bet", "bet", "bet"], ["bind", "bound", "bound"],
  ["bite", "bit", "bitten"], ["bleed", "bled", "bled"], ["blow", "blew", "blown"], ["break", "broke", "broken"], ["breed", "bred", "bred"],
  ["bring", "brought", "brought"], ["build", "built", "built"], ["burn", "burnt", "burnt"], ["burst", "burst", "burst"], ["buy", "bought", "bought"],
  ["cast", "cast", "cast"], ["catch", "caught", "caught"], ["choose", "chose", "chosen"], ["cling", "clung", "clung"], ["come", "came", "come"],
  ["cost", "cost", "cost"], ["creep", "crept", "crept"], ["cut", "cut", "cut"], ["deal", "dealt", "dealt"], ["dig", "dug", "dug"],
  ["do", "did", "done"], ["draw", "drew", "drawn"], ["dream", "dreamt", "dreamt"], ["drink", "drank", "drunk"], ["drive", "drove", "driven"],
  ["eat", "ate", "eaten"], ["fall", "fell", "fallen"], ["feed", "fed", "fed"], ["feel", "felt", "felt"], ["fight", "fought", "fought"],
  ["find", "found", "found"], ["flee", "fled", "fled"], ["fling", "flung", "flung"], ["fly", "flew", "flown"], ["forbid", "forbade", "forbidden"],
  ["forget", "forgot", "forgotten"], ["forgive", "forgave", "forgiven"], ["freeze", "froze", "frozen"], ["get", "got", "gotten"], ["give", "gave", "given"],
  ["go", "went", "gone"], ["grind", "ground", "ground"], ["grow", "grew", "grown"], ["hang", "hung", "hung"], ["have", "had", "had"],
  ["hear", "heard", "heard"], ["hide", "hid", "hidden"], ["hit", "hit", "hit"], ["hold", "held", "held"], ["hurt", "hurt", "hurt"],
  ["keep", "kept", "kept"], ["kneel", "knelt", "knelt"], ["know", "knew", "known"], ["lay", "laid", "laid"], ["lead", "led", "led"],
  ["lean", "leant", "leant"], ["leap", "leapt", "leapt"], ["learn", "learnt", "learnt"], ["leave", "left", "left"], ["lend", "lent", "lent"],
  ["let", "let", "let"], ["lie", "lay", "lain"], ["light", "lit", "lit"], ["lose", "lost", "lost"], ["make", "made", "made"],
  ["mean", "meant", "meant"], ["meet", "met", "met"], ["pay", "paid", "paid"], ["put", "put", "put"], ["quit", "quit", "quit"],
  ["read", "read", "read"], ["ride", "rode", "ridden"], ["ring", "rang", "rung"], ["rise", "rose", "risen"], ["run", "ran", "run"],
  ["say", "said", "said"], ["see", "saw", "seen"], ["seek", "sought", "sought"], ["sell", "sold", "sold"], ["send", "sent", "sent"],
  ["set", "set", "set"], ["shake", "shook", "shaken"], ["shed", "shed", "shed"], ["shine", "shone", "shone"], ["shoot", "shot", "shot"],
  ["show", "showed", "shown"], ["shrink", "shrank", "shrunk"], ["shut", "shut", "shut"], ["sing", "sang", "sung"], ["sink", "sank", "sunk"],
  ["sit", "sat", "sat"], ["slay", "slew", "slain"], ["sleep", "slept", "slept"], ["slide", "slid", "slid"], ["sling", "slung", "slung"],
  ["slit", "slit", "slit"], ["smell", "smelt", "smelt"], ["speak", "spoke", "spoken"], ["speed", "sped", "sped"], ["spend", "spent", "spent"],
  ["spill", "spilt", "spilt"], ["spin", "spun", "spun"], ["spit", "spat", "spat"], ["split", "split", "split"], ["spread", "spread", "spread"],
  ["spring", "sprang", "sprung"], ["stand", "stood", "stood"], ["steal", "stole", "stolen"], ["stick", "stuck", "stuck"], ["sting", "stung", "stung"],
  ["stink", "stank", "stunk"], ["stride", "strode", "stridden"], ["strike", "struck", "struck"], ["string", "strung", "strung"], ["strive", "strove", "striven"],
  ["swear", "swore", "sworn"], ["sweep", "swept", "swept"], ["swell", "swelled", "swollen"], ["swim", "swam", "swum"], ["swing", "swung", "swung"],
  ["take", "took", "taken"], ["teach", "taught", "taught"], ["tear", "tore", "torn"], ["tell", "told", "told"], ["think", "thought", "thought"],
  ["throw", "threw", "thrown"], ["tread", "trod", "trodden"], ["understand", "understood", "understood"], ["wake", "woke", "woken"], ["wear", "wore", "worn"],
  ["weave", "wove", "woven"], ["weep", "wept", "wept"], ["win", "won", "won"], ["wind", "wound", "wound"], ["withdraw", "withdrew", "withdrawn"],
  ["wring", "wrung", "wrung"], ["write", "wrote", "written"],
];
const PLURALS: [string, string][] = [
  ["man", "men"], ["woman", "women"], ["child", "children"], ["foot", "feet"], ["tooth", "teeth"], ["goose", "geese"], ["mouse", "mice"],
  ["person", "people"], ["ox", "oxen"], ["louse", "lice"], ["die", "dice"], ["wolf", "wolves"], ["knife", "knives"], ["life", "lives"],
  ["wife", "wives"], ["leaf", "leaves"], ["half", "halves"], ["thief", "thieves"], ["elf", "elves"], ["dwarf", "dwarves"], ["shelf", "shelves"],
  ["self", "selves"], ["calf", "calves"], ["loaf", "loaves"], ["staff", "staves"], ["sheep", "sheep"], ["deer", "deer"], ["fish", "fish"],
];
const COMPARE: [string, string, string][] = [
  ["good", "better", "best"], ["bad", "worse", "worst"], ["far", "farther", "farthest"], ["little", "less", "least"], ["many", "more", "most"], ["much", "more", "most"],
];

const pastOf = new Map(VERBS.map(([b, p, pp]) => [b, { past: p, pp }]));
const pluralOf = new Map(PLURALS);
const compareOf = new Map(COMPARE.map(([b, er, est]) => [b, { er, est }]));
const fromIrregular = new Map<string, { base: string; form: Form }[]>();
const addIrregular = (word: string, base: string, form: Form) => {
  if (word === base) return;
  if (!fromIrregular.has(word)) fromIrregular.set(word, []);
  fromIrregular.get(word)!.push({ base, form });
};
for (const [b, p, pp] of VERBS) (addIrregular(p, b, "past"), addIrregular(pp, b, "pp"));
for (const [b, pl] of PLURALS) addIrregular(pl, b, "plural");
for (const [b, er, est] of COMPARE) (addIrregular(er, b, "er"), addIrregular(est, b, "est"));

const VOWEL = /[aeiou]/;
/** Short words ending consonant-vowel-consonant double the last letter: "run" -> "running". */
const doubles = (w: string) => /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(w);

/** Possible dictionary forms of a word, most likely first. */
export function baseForms(word: string): { base: string; form: Form }[] {
  const w = word.toLowerCase();
  const out: { base: string; form: Form }[] = [{ base: w, form: "" }, ...(fromIrregular.get(w) ?? [])];
  const strip = (suffix: string, add: string, form: Form) => {
    if (w.length > suffix.length + 1 && w.endsWith(suffix)) out.push({ base: w.slice(0, -suffix.length) + add, form });
  };
  const undouble = (suffix: string, form: Form) => {
    const stem = w.slice(0, -suffix.length);
    if (w.endsWith(suffix) && stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && !VOWEL.test(stem[stem.length - 1])) out.push({ base: stem.slice(0, -1), form });
  };
  strip("ies", "y", "plural"), strip("ses", "s", "plural"), strip("xes", "x", "plural"), strip("zes", "z", "plural");
  strip("ches", "ch", "plural"), strip("shes", "sh", "plural"), strip("es", "e", "plural"), strip("s", "", "plural");
  undouble("ing", "ing"), strip("ing", "e", "ing"), strip("ing", "", "ing"), strip("ying", "ie", "ing");
  undouble("ed", "ed"), strip("ied", "y", "ed"), strip("ed", "e", "ed"), strip("ed", "", "ed");
  undouble("est", "est"), strip("iest", "y", "est"), strip("est", "e", "est"), strip("est", "", "est");
  undouble("er", "er"), strip("ier", "y", "er"), strip("er", "e", "er"), strip("er", "", "er");
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(`${c.base}|${c.form}`) && (seen.add(`${c.base}|${c.form}`), true));
}

/** The parts of speech an ending can make: "-ing" on a dictionary word is a verb form. */
const FORM_POS: Record<Form, PartOfSpeech[]> = {
  "": ["n", "v", "a", "r"],
  plural: ["n", "v"], // "runs" is a plural noun or a verb
  s: ["v"],
  ed: ["v"],
  past: ["v"],
  pp: ["v"],
  ing: ["v"],
  er: ["a", "r"],
  est: ["a", "r"],
};
const POS_ORDER: PartOfSpeech[] = ["n", "v", "a", "r"];

/**
 * Alternatives for a word as it appears in the text: the meanings of the word itself and of
 * its dictionary form ("running" is a noun of its own, and a form of the verb "run"), the more
 * commonly used first. Empty if the thesaurus doesn't know the word.
 */
export async function lookup(word: string): Promise<Sense[]> {
  const t = await loadThesaurus();
  const has = (w: string) => Object.prototype.hasOwnProperty.call(t.i, w);
  const groups: { weight: number; senses: Sense[] }[] = [];
  for (const c of baseForms(word)) {
    if (!has(c.base)) continue;
    const allowed = FORM_POS[c.form];
    const counts = (has(c.base) && Object.prototype.hasOwnProperty.call(t.u, c.base) ? t.u[c.base] : "0,0,0,0").split(",").map(Number);
    // The word exactly as written wins ties.
    const weight = allowed.reduce((n, p) => n + counts[POS_ORDER.indexOf(p)], 0) + (c.form ? 0 : 0.5);
    const senses = t.i[c.base]
      .map((id) => t.s[id])
      .filter(([pos]) => allowed.includes(pos))
      .map(([pos, gloss, syn, rel, opp]): Sense => ({
        pos,
        base: c.base,
        // "-s" is a plural on a noun and the present tense on a verb.
        form: c.form === "plural" && pos === "v" ? "s" : c.form,
        gloss,
        synonyms: syn.split("|").filter((s) => s && s !== c.base),
        related: rel ? rel.split("|") : [],
        opposites: opp ? opp.split("|") : [],
      }))
      .filter((s) => s.synonyms.length || s.related.length);
    if (senses.length) groups.push({ weight, senses });
  }
  return groups.sort((a, b) => b.weight - a.weight).flatMap((g) => g.senses);
}

// ---- putting a replacement into the same form

function inflectWord(w: string, form: Form, pos: PartOfSpeech): string {
  switch (form) {
    case "plural":
    case "s":
      if (form === "plural" && pluralOf.has(w)) return pluralOf.get(w)!;
      if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
      if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
      return `${w}s`;
    case "ed":
    case "past":
    case "pp": {
      const irregular = pastOf.get(w);
      if (irregular) return form === "pp" ? irregular.pp : irregular.past;
      if (w.endsWith("e")) return `${w}d`;
      if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ied`;
      return doubles(w) ? `${w}${w[w.length - 1]}ed` : `${w}ed`;
    }
    case "ing":
      if (w.endsWith("ie")) return `${w.slice(0, -2)}ying`;
      if (/[^aeioy]e$/.test(w)) return `${w.slice(0, -1)}ing`;
      return doubles(w) ? `${w}${w[w.length - 1]}ing` : `${w}ing`;
    case "er":
    case "est": {
      const irregular = compareOf.get(w);
      if (irregular) return irregular[form];
      if (pos === "r" || (w.length > 6 && !w.endsWith("y"))) return `${form === "er" ? "more" : "most"} ${w}`;
      const end = form === "er" ? "er" : "est";
      if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}i${end}`;
      if (w.endsWith("e")) return `${w}${end.slice(1)}`;
      return doubles(w) ? `${w}${w[w.length - 1]}${end}` : `${w}${end}`;
    }
    default:
      return w;
  }
}

/** A replacement in the same form and capitalisation as the word it replaces. */
export function fitReplacement(original: string, replacement: string, form: Form, pos: PartOfSpeech): string {
  let out = replacement;
  if (form) {
    const words = replacement.split(" ");
    // Verbs change their first word ("turn tail" -> "turned tail"); nouns their last ("light source" -> "light sources").
    const at = pos === "n" ? words.length - 1 : 0;
    if (words.length > 1 && (form === "er" || form === "est")) out = `${form === "er" ? "more" : "most"} ${replacement}`;
    else {
      words[at] = inflectWord(words[at], form, pos);
      out = words.join(" ");
    }
  }
  if (original.length > 1 && original === original.toUpperCase()) return out.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) return out[0].toUpperCase() + out.slice(1);
  return out;
}

export const POS_LABEL: Record<PartOfSpeech, string> = { n: "noun", v: "verb", a: "adjective", r: "adverb" };
