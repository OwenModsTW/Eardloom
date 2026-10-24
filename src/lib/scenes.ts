// Chapters as scenes in the world: who's in them, where and when they happen, the plot threads
// they carry, and the continuity problems that can be spotted from that.

import { formatDate, sortKey } from "./calendar";
import type { Calendar, Entry, EntryType, SceneMeta, WorldDate } from "./types";

export interface Scene {
  id: string;
  projectId: string;
  title: string;
  meta: SceneMeta;
  /** Entries the text mentions. */
  mentions: string[];
}

const unique = (ids: (string | undefined)[]) => [...new Set(ids.filter((x): x is string => !!x))];

/**
 * Who's in a scene: everyone the text mentions or the author added, minus anyone marked as only
 * mentioned, plus the point-of-view character. The location itself isn't a person in the scene.
 */
export function presentIn(scene: Pick<Scene, "meta" | "mentions">): string[] {
  const { pov, location, present = [], absent = [] } = scene.meta;
  return unique([pov, ...scene.mentions, ...present]).filter((id) => id !== location && (id === pov || !absent.includes(id)));
}

/** The scenes an entry is part of, and how. */
export function scenesFor(entryId: string, scenes: Scene[]) {
  return scenes
    .map((s) => ({
      scene: s,
      role: s.meta.pov === entryId ? ("pov" as const) : s.meta.location === entryId ? ("location" as const) : presentIn(s).includes(entryId) ? ("present" as const) : null,
    }))
    .filter((x): x is { scene: Scene; role: "pov" | "location" | "present" } => !!x.role);
}

export interface Check {
  kind: "two-places" | "before-birth" | "after-death" | "pov-gap" | "thread-gap";
  message: string;
  docId?: string;
  entryId?: string;
}

/** A character's birth and death dates, from date fields named like "Born" and "Died". */
export function lifeDates(entry: Entry, type: EntryType | undefined): { born?: WorldDate; died?: WorldDate } {
  const out: { born?: WorldDate; died?: WorldDate } = {};
  for (const f of type?.fields ?? []) {
    if (f.kind !== "worlddate") continue;
    const v = entry.fields[f.id] as WorldDate | undefined;
    if (!v || typeof v !== "object" || typeof v.year !== "number") continue;
    if (/born|birth/i.test(f.label)) out.born = v;
    if (/died|death|deceased|killed/i.test(f.label)) out.died = v;
    // A lifetime written as a span ("Lived: 380–452") gives both.
    if (/lived|life|lifetime/i.test(f.label)) {
      out.born ??= v;
      if (v.end) out.died ??= { ...v.end };
    }
  }
  return out;
}

/** How many scenes a point of view or thread can go quiet for before it's mentioned. */
export const QUIET_AFTER = 6;

/**
 * Continuity problems in a book's scenes (given in reading order): someone in two places on the
 * same date, appearing before they're born or after they've died, a point of view or a plot
 * thread that has gone quiet.
 */
export function continuityChecks(
  ordered: Scene[],
  ctx: { calendar: Calendar; entries: Map<string, Entry>; types: EntryType[]; threads: { id: string; name: string }[]; title: (id: string) => string },
): Check[] {
  const out: Check[] = [];
  const { calendar, title } = ctx;
  const when = (d: WorldDate) => formatDate(calendar, d);

  // Two places at once: the same person in scenes set on the same date in different places.
  const byDate = new Map<number, Scene[]>();
  for (const s of ordered) {
    if (!s.meta.date || !s.meta.location) continue;
    const key = sortKey(calendar, s.meta.date);
    if (s.meta.date.day === undefined) continue; // a whole year or month leaves room to travel
    byDate.set(key, [...(byDate.get(key) ?? []), s]);
  }
  for (const group of byDate.values()) {
    const seen = new Map<string, Scene>();
    for (const s of group)
      for (const person of presentIn(s)) {
        const other = seen.get(person);
        if (other && other.meta.location !== s.meta.location)
          out.push({
            kind: "two-places",
            entryId: person,
            docId: s.id,
            message: `${title(person)} is at ${title(other.meta.location!)} in “${other.title}” and at ${title(s.meta.location!)} in “${s.title}”, both on ${when(s.meta.date!)}.`,
          });
        else if (!other) seen.set(person, s);
      }
  }

  // Before they were born, or after they died.
  for (const s of ordered) {
    if (!s.meta.date) continue;
    const at = sortKey(calendar, s.meta.date);
    for (const person of presentIn(s)) {
      const entry = ctx.entries.get(person);
      if (!entry) continue;
      const { born, died } = lifeDates(entry, ctx.types.find((t) => t.id === entry.typeId));
      if (born && at < sortKey(calendar, born))
        out.push({ kind: "before-birth", entryId: person, docId: s.id, message: `${title(person)} appears in “${s.title}” (${when(s.meta.date)}), before they were born (${when(born)}).` });
      if (died && at > sortKey(calendar, died))
        out.push({ kind: "after-death", entryId: person, docId: s.id, message: `${title(person)} appears in “${s.title}” (${when(s.meta.date)}), after their death (${when(died)}). A flashback or a ghost? If not, worth a look.` });
    }
  }

  // A point-of-view character who hasn't had a scene for a long while (only with several POVs).
  const povs = unique(ordered.map((s) => s.meta.pov));
  if (povs.length > 1)
    for (const pov of povs) {
      const last = ordered.map((s) => s.meta.pov).lastIndexOf(pov);
      const quiet = ordered.length - 1 - last;
      if (quiet >= QUIET_AFTER)
        out.push({ kind: "pov-gap", entryId: pov, docId: ordered[last].id, message: `${title(pov)} hasn't been the point of view for ${quiet} chapters, since “${ordered[last].title}”.` });
    }

  // A plot thread that hasn't come up for a long while.
  for (const thread of ctx.threads) {
    const last = ordered.map((s) => s.meta.threads?.includes(thread.id) ?? false).lastIndexOf(true);
    if (last < 0) continue;
    const quiet = ordered.length - 1 - last;
    if (quiet >= QUIET_AFTER)
      out.push({ kind: "thread-gap", docId: ordered[last].id, message: `“${thread.name}” hasn't come up for ${quiet} chapters, since “${ordered[last].title}”.` });
  }
  return out;
}
