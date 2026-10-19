import { api } from "../api";

/** Chapters already given an automatic snapshot this session. */
const done = new Set<string>();

/** Keeps a chapter as it was before this session's first edit, as a safety net. */
export function snapshotBeforeFirstEdit(docId: string, wordCount: number) {
  if (done.has(docId)) return;
  done.add(docId);
  if (wordCount > 0) api.createSnapshot(docId, "", true).catch(() => {});
}
