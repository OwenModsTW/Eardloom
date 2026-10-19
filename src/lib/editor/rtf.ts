import type { JSONContent } from "@tiptap/react";

/** Groups whose contents are never text: fonts, colours, images, metadata... */
const SKIP = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "listtable", "listoverridetable", "rsidtbl",
  "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "header", "headerl",
  "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "footnote", "fldinst", "bkmkstart", "bkmkend",
  "listtext", "pntext", "pntxta", "pntxtb", "shp", "nonshppict", "annotation", "atnid", "atnauthor",
]);

/** Windows-1252 bytes 0x80–0x9F, which differ from Latin-1. */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

const SYMBOLS: Record<string, string> = {
  emdash: "—", endash: "–", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", bullet: "•", tab: "\t",
  emspace: " ", enspace: " ", qmspace: " ",
};

interface CharState {
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  sup: boolean;
  sub: boolean;
  skip: boolean;
  uc: number;
}

interface Run {
  text: string;
  marks: string[];
}

interface Para {
  align?: string;
  runs: (Run | "br")[];
}

const TOKEN = /\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/gy;

/** Some writing apps embed style markers like <$Scr_Ps::0> and <!$Scr_H::2> into the text. */
const STYLE_MARKER = /<!?\$Scr_([A-Za-z]+)::(\d+)>/g;

function parse(rtf: string): Para[] {
  const paras: Para[] = [];
  let para: Para = { runs: [] };
  let align: string | undefined;
  const stack: CharState[] = [];
  let st: CharState = { b: false, i: false, u: false, s: false, sup: false, sub: false, skip: false, uc: 1 };
  let skipChars = 0;

  const emit = (text: string) => {
    if (st.skip || !text) return;
    const marks: string[] = [];
    if (st.b) marks.push("bold");
    if (st.i) marks.push("italic");
    if (st.u) marks.push("underline");
    if (st.s) marks.push("strike");
    if (st.sup) marks.push("superscript");
    if (st.sub) marks.push("subscript");
    const last = para.runs[para.runs.length - 1];
    if (last && last !== "br" && last.marks.join() === marks.join()) last.text += text;
    else para.runs.push({ text, marks });
  };
  const endPara = () => {
    para.align = align;
    paras.push(para);
    para = { runs: [] };
  };

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(rtf); m; m = TOKEN.exec(rtf)) {
    const [, word, arg, hex, sym, brace, text] = m;
    // After \uN, skip the fallback character(s) that follow it.
    if (skipChars > 0 && (hex || text)) {
      if (hex) {
        skipChars--;
        continue;
      }
      if (text) {
        const drop = Math.min(skipChars, text.length);
        skipChars -= drop;
        emit(text.slice(drop));
        continue;
      }
    }
    skipChars = 0;
    if (brace === "{") stack.push({ ...st });
    else if (brace === "}") st = stack.pop() ?? st;
    else if (text) emit(text);
    else if (hex) {
      const code = parseInt(hex, 16);
      emit(CP1252[code] ?? String.fromCharCode(code));
    } else if (sym) {
      if (sym === "*") st.skip = true;
      else if (sym === "~") emit(" ");
      else if (sym === "_") emit("‑");
      else if (sym === "\\" || sym === "{" || sym === "}") emit(sym);
      else if (sym === "\n" || sym === "\r") endPara();
    } else if (word) {
      const on = arg !== "0";
      if (SKIP.has(word)) st.skip = true;
      else if (word === "par" || word === "sect") endPara();
      else if (word === "line") !st.skip && para.runs.push("br");
      else if (word === "pard") align = undefined;
      else if (word === "qc") align = "center";
      else if (word === "qr") align = "right";
      else if (word === "qj") align = "justify";
      else if (word === "ql") align = undefined;
      else if (word === "plain") Object.assign(st, { b: false, i: false, u: false, s: false, sup: false, sub: false });
      else if (word === "b") st.b = on;
      else if (word === "i") st.i = on;
      else if (word === "ul") st.u = on;
      else if (word === "ulnone") st.u = false;
      else if (word === "strike" || word === "striked") st.s = on;
      else if (word === "super") (st.sup = on), (st.sub = false);
      else if (word === "sub") (st.sub = on), (st.sup = false);
      else if (word === "nosupersub") st.sup = st.sub = false;
      else if (word === "uc") st.uc = Number(arg ?? 1);
      else if (word === "u") {
        const n = Number(arg);
        emit(String.fromCharCode(n < 0 ? n + 65536 : n));
        skipChars = st.uc;
      } else if (word === "bin") {
        TOKEN.lastIndex += Number(arg ?? 0);
      } else if (SYMBOLS[word]) emit(SYMBOLS[word]);
    }
  }
  if (para.runs.length) endPara();
  return paras;
}

/** RTF (as copied from word processors and writing apps) to editor paragraphs. */
export function rtfToContent(rtf: string): JSONContent[] {
  if (!rtf.trimStart().startsWith("{\\rtf")) return [];
  const out: JSONContent[] = [];
  for (const p of parse(rtf)) {
    // Heading style markers become real headings; other markers are dropped.
    let heading = 0;
    const content: JSONContent[] = [];
    for (const r of p.runs) {
      if (r === "br") {
        content.push({ type: "hardBreak" });
        continue;
      }
      const text = r.text.replace(STYLE_MARKER, (_, kind: string, level: string) => {
        if (kind === "H") heading = Math.min(3, Math.max(1, Number(level)));
        return "";
      });
      if (text) content.push(r.marks.length ? { type: "text", text, marks: r.marks.map((type) => ({ type })) } : { type: "text", text });
    }
    // Drop line breaks at the very start or end of a paragraph.
    while (content[0]?.type === "hardBreak") content.shift();
    while (content[content.length - 1]?.type === "hardBreak") content.pop();
    const attrs = p.align ? { textAlign: p.align } : undefined;
    const empty = content.every((c) => c.type === "hardBreak" || !c.text?.trim());
    if (empty) {
      // Keep single blank lines, collapse runs of them.
      if (out.length && out[out.length - 1].content?.length) out.push({ type: "paragraph" });
      continue;
    }
    out.push(heading ? { type: "heading", attrs: { level: heading, ...attrs }, content } : { type: "paragraph", ...(attrs ? { attrs } : {}), content });
  }
  while (out.length && !out[out.length - 1].content?.length) out.pop();
  return out;
}
