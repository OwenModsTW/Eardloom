import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { misspelt, spellingOn, useSpellVersion } from "../spell";

const key = new PluginKey<DecorationSet>("spellcheck");

/** Letters, with apostrophes allowed inside (don't, Qi'mir). */
const WORD = /\p{L}[\p{L}\p{M}'’]*\p{L}|\p{L}/gu;

interface Found {
  word: string;
  from: number;
  to: number;
}

function words(doc: PMNode): Found[] {
  const out: Found[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    // Code and links aren't prose.
    if (node.marks.some((m) => m.type.name === "code" || m.type.name === "link")) return false;
    WORD.lastIndex = 0;
    for (let m = WORD.exec(node.text); m; m = WORD.exec(node.text)) {
      const w = m[0];
      // Short all-caps words are usually acronyms.
      if (w.length <= 5 && w === w.toUpperCase() && w.length > 1) continue;
      out.push({ word: w, from: pos + m.index, to: pos + m.index + w.length });
    }
    return false;
  });
  return out;
}

async function check(view: EditorView) {
  if (!spellingOn()) {
    view.dispatch(view.state.tr.setMeta(key, DecorationSet.empty));
    return;
  }
  const doc = view.state.doc;
  const found = words(doc);
  const wrong = await misspelt(found.map((f) => f.word));
  // The document may have changed while we waited; results are mapped below via apply().
  if (view.isDestroyed || view.state.doc !== doc) return;
  const head = view.state.selection.head;
  const decos = found
    // Don't nag about the word being typed right now.
    .filter((f) => wrong.has(f.word) && !(view.hasFocus() && head >= f.from && head <= f.to))
    .map((f) => Decoration.inline(f.from, f.to, { class: "spell-error", "data-word": f.word }));
  view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(doc, decos)));
}

/** Underlines unknown words using Eardloom's own dictionary (so words can be learned). */
export const Spellcheck = Extension.create({
  name: "spellcheck",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(key) as DecorationSet | undefined;
            return next ?? set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (state) => key.getState(state) },
        view(view) {
          let timer: number | undefined;
          const schedule = (delay: number) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void check(view), delay);
          };
          schedule(50);
          const unsubscribe = useSpellVersion.subscribe(() => schedule(50));
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule(600);
              // Leaving a word: check it now rather than waiting.
              else if (v.state.selection.head !== prev.selection.head) schedule(150);
            },
            destroy() {
              window.clearTimeout(timer);
              unsubscribe();
            },
          };
        },
      }),
    ];
  },
});
