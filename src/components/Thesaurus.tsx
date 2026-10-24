import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search, X } from "lucide-react";
import { byCommonness, fitReplacement, lookup, POS_LABEL, type Sense } from "../lib/thesaurus";

/**
 * Every meaning of a word with its alternatives. Click a word to use it in the text (in the
 * same form: "running" -> "sprinting"); Ctrl+click to look that word up instead.
 */
export function ThesaurusPanel({
  word,
  at,
  onUse,
  onClose,
}: {
  /** The word as it appears in the text. */
  word: string;
  /** Where to show the panel (near the word). */
  at: { x: number; y: number };
  /** Called with the replacement, already in the right form. */
  onUse: (replacement: string) => void;
  onClose: () => void;
}) {
  const [trail, setTrail] = useState<string[]>([word]);
  const current = trail[trail.length - 1];
  const [query, setQuery] = useState(word);
  const [senses, setSenses] = useState<Sense[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // The original word's meanings: a word looked up later is put into the same form as it.
  const [original, setOriginal] = useState<Sense[]>([]);

  useEffect(() => {
    setSenses(null);
    setQuery(current);
    lookup(current).then(
      (s) => {
        setSenses(s);
        if (trail.length === 1) setOriginal(s);
      },
      (e) => setError(String(e)),
    );
  }, [current]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    const click = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
    window.addEventListener("keydown", key, true);
    window.addEventListener("mousedown", click);
    return () => (window.removeEventListener("keydown", key, true), window.removeEventListener("mousedown", click));
  }, [onClose]);

  const use = (w: string, sense: Sense) => {
    // On the first page the meaning knows its form; after looking up another word, match the original's.
    const like = trail.length === 1 ? sense : (original.find((s) => s.pos === sense.pos) ?? null);
    onUse(fitReplacement(word, w, like?.form ?? "", sense.pos));
  };
  const chip = (w: string, sense: Sense) => (
    <button
      key={w}
      className="thes-word"
      title="Click to use · Ctrl+click to look it up"
      onClick={(e) => (e.ctrlKey || e.metaKey ? setTrail((t) => [...t, w]) : use(w, sense))}
    >
      {w}
    </button>
  );

  // Keep the panel on screen.
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 388));
  const top = Math.max(8, Math.min(at.y + 8, window.innerHeight - 468));

  return (
    <div className="thesaurus" ref={box} style={{ left, top }} role="dialog" aria-label="Thesaurus">
      <header className="thes-head">
        {trail.length > 1 && (
          <button className="icon-btn" onClick={() => setTrail((t) => t.slice(0, -1))} title="Back">
            <ArrowLeft size={14} />
          </button>
        )}
        <form className="search-inline" onSubmit={(e) => (e.preventDefault(), query.trim() && setTrail((t) => [...t, query.trim()]))}>
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Look up a word" />
        </form>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </header>
      <div className="thes-body">
        {error ? (
          <p className="hint">{error}</p>
        ) : !senses ? (
          <p className="hint">Looking up…</p>
        ) : senses.length === 0 ? (
          <p className="hint">No alternatives for “{current}”. Try another form of the word.</p>
        ) : (
          senses.map((s, i) => (
            <section key={i} className="thes-sense">
              <p className="thes-meaning">
                <em>{POS_LABEL[s.pos]}</em> {s.gloss}
              </p>
              {s.synonyms.length > 0 && <div className="thes-words">{[...s.synonyms].sort(byCommonness).map((w) => chip(w, s))}</div>}
              {s.related.length > 0 && (
                <div className="thes-words related">
                  <span>{s.pos === "a" ? "Similar" : "Broader"}</span>
                  {[...s.related].sort(byCommonness).map((w) => chip(w, s))}
                </div>
              )}
              {s.opposites.length > 0 && (
                <div className="thes-words opposite">
                  <span>Opposite</span>
                  {s.opposites.map((w) => chip(w, s))}
                </div>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export { topAlternatives } from "../lib/thesaurus";
