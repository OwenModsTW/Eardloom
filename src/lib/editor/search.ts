import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface Match {
  from: number;
  to: number;
}

interface SearchState extends SearchOptions {
  term: string;
  matches: Match[];
  current: number;
}

export const searchKey = new PluginKey<SearchState>("search");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildRegex(term: string, o: SearchOptions) {
  if (!term) return null;
  const body = o.wholeWord ? `(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])` : escape(term);
  return new RegExp(body, o.caseSensitive ? "gu" : "giu");
}

/**
 * Finds matches inside each paragraph as one string, so a match can span
 * bold/italic boundaries. Mentions and line breaks act as separators.
 */
export function findMatches(doc: PMNode, term: string, o: SearchOptions): Match[] {
  const re = buildRegex(term, o);
  if (!re) return [];
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let i = 0; i < child.text.length; i++) map.push(start + i);
        text += child.text;
      } else {
        map.push(start);
        text += "￼";
      }
    });
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return out;
}

const getState = (state: EditorState) => searchKey.getState(state)!;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearch: (term: string, options?: Partial<SearchOptions>) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
}

/** Selects (and scrolls to) a match without moving keyboard focus out of the find box. */
function select(tr: import("@tiptap/pm/state").Transaction, m: Match | undefined) {
  if (m) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
  return tr;
}

export const Search = Extension.create({
  name: "search",

  addCommands() {
    return {
      setSearch:
        (term, options = {}) =>
        ({ state, tr, dispatch }) => {
          const prev = getState(state);
          const o = { caseSensitive: options.caseSensitive ?? prev.caseSensitive, wholeWord: options.wholeWord ?? prev.wholeWord };
          const matches = findMatches(state.doc, term, o);
          // Start from the first match after the cursor, like a word processor.
          const after = matches.findIndex((m) => m.from >= state.selection.from);
          const current = matches.length ? (after === -1 ? 0 : after) : -1;
          if (dispatch) dispatch(select(tr.setMeta(searchKey, { term, ...o, matches, current }), matches[current]));
          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const s = getState(state);
          if (!s.matches.length) return false;
          const current = (s.current + 1) % s.matches.length;
          if (dispatch) dispatch(select(tr.setMeta(searchKey, { ...s, current }), s.matches[current]));
          return true;
        },
      findPrevious:
        () =>
        ({ state, tr, dispatch }) => {
          const s = getState(state);
          if (!s.matches.length) return false;
          const current = (s.current - 1 + s.matches.length) % s.matches.length;
          if (dispatch) dispatch(select(tr.setMeta(searchKey, { ...s, current }), s.matches[current]));
          return true;
        },
      replaceCurrent:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = getState(state);
          const m = s.matches[s.current];
          if (!m) return false;
          if (dispatch) {
            tr.insertText(replacement, m.from, m.to);
            const matches = findMatches(tr.doc, s.term, s);
            const next = matches.findIndex((x) => x.from >= m.from + replacement.length);
            const current = matches.length ? (next === -1 ? 0 : next) : -1;
            dispatch(select(tr.setMeta(searchKey, { ...s, matches, current }), matches[current]));
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = getState(state);
          if (!s.matches.length) return false;
          if (dispatch) {
            // Back to front, so earlier positions stay valid.
            [...s.matches].reverse().forEach((m) => tr.insertText(replacement, m.from, m.to));
            dispatch(tr.setMeta(searchKey, { ...s, matches: findMatches(tr.doc, s.term, s), current: -1 }));
          }
          return true;
        },
      clearSearch:
        () =>
        ({ state, tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchKey, { ...getState(state), term: "", matches: [], current: -1 }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ term: "", caseSensitive: false, wholeWord: false, matches: [], current: -1 }),
          apply(tr, value) {
            const meta = tr.getMeta(searchKey) as SearchState | undefined;
            if (meta) return meta;
            if (!tr.docChanged || !value.term) return value;
            // Typing while the find bar is open: keep highlights in step.
            const matches = findMatches(tr.doc, value.term, value);
            return { ...value, matches, current: Math.min(value.current, matches.length - 1) };
          },
        },
        props: {
          decorations(state) {
            const s = searchKey.getState(state);
            if (!s?.matches.length) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? "find-hit current" : "find-hit" })),
            );
          },
        },
      }),
    ];
  },
});

export const searchState = (state: EditorState) => searchKey.getState(state);
