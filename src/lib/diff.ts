export type Op<T> = { type: "same" | "add" | "del"; value: T };

/** Longest-common-subsequence diff. Fine for paragraphs, or words within one paragraph. */
export function diff<T>(a: T[], b: T[]): Op<T>[] {
  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: Op<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ type: "same", value: a[i++] }), j++;
    else if (table[i + 1][j] >= table[i][j + 1]) out.push({ type: "del", value: a[i++] });
    else out.push({ type: "add", value: b[j++] });
  }
  while (i < n) out.push({ type: "del", value: a[i++] });
  while (j < m) out.push({ type: "add", value: b[j++] });
  return out;
}

const tokens = (p: string) => p.match(/\s+|[^\s]+/g) ?? [];
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

export type Block =
  | { kind: "same"; text: string }
  | { kind: "add" | "del"; text: string }
  | { kind: "changed"; parts: Op<string>[] };

/**
 * Compares two versions paragraph by paragraph; a paragraph that was edited
 * (rather than added or removed) gets a word-level comparison.
 */
export function compareParagraphs(before: string[], after: string[]) {
  const ops = diff(before, after);
  const blocks: Block[] = [];
  let added = 0;
  let removed = 0;
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const next = ops[k + 1];
    if (op.type === "same") blocks.push({ kind: "same", text: op.value });
    else if (op.type === "del" && next?.type === "add") {
      const a = tokens(op.value);
      const b = tokens(next.value);
      // Very long paragraphs are shown as replaced rather than diffed word by word.
      if (a.length * b.length > 4_000_000) {
        blocks.push({ kind: "del", text: op.value }, { kind: "add", text: next.value });
        removed += wordCount(op.value);
        added += wordCount(next.value);
      } else {
        const parts = diff(a, b);
        for (const p of parts) {
          if (p.type === "add") added += wordCount(p.value);
          if (p.type === "del") removed += wordCount(p.value);
        }
        blocks.push({ kind: "changed", parts });
      }
      k++;
    } else {
      blocks.push({ kind: op.type, text: op.value });
      if (op.type === "add") added += wordCount(op.value);
      else removed += wordCount(op.value);
    }
  }
  return { blocks, added, removed };
}
