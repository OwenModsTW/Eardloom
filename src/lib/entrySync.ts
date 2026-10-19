import { create } from "zustand";

// Keeps an open entry page and changes made elsewhere (the assistant, restoring a version)
// from overwriting each other: changes flush the page's pending edits first, and the page
// reloads afterwards.

const flushers = new Map<string, () => Promise<void>>();

/** Lets the page showing an entry save its pending edits on request. Returns an unregister function. */
export function registerEntryFlush(id: string, flush: () => Promise<void>) {
  flushers.set(id, flush);
  return () => {
    if (flushers.get(id) === flush) flushers.delete(id);
  };
}

/** Saves any edits still pending on the entry's open page. */
export async function flushEntry(id: string) {
  await flushers.get(id)?.();
}

export const useEntryRevision = create<{ revs: Record<string, number> }>(() => ({ revs: {} }));

/** Tells an open page that its entry was changed elsewhere, so it reloads. */
export function entryChanged(id: string) {
  useEntryRevision.setState((s) => ({ revs: { ...s.revs, [id]: (s.revs[id] ?? 0) + 1 } }));
}
