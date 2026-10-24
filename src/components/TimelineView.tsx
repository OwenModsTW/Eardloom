import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { createEntry } from "../lib/actions";
import { eraOf, formatDate, sortKey, spanYears } from "../lib/calendar";
import { EntryGlyph } from "./EntryIcon";
import { BookOpen } from "lucide-react";
import { openMenu } from "./ContextMenu";
import type { TimelineItem, WorldDatePoint } from "../lib/types";

/** Chapters with a date in their scene details sit on the timeline too, under this "type". */
const STORY = "__story";

/** Labels that just mean "the date" aren't worth repeating on every row. */
const GENERIC = new Set(["date", "when", "date on the timeline"]);

/** Every dated field in the world, in order, grouped by era. */
export function TimelineView() {
  const { types, calendar, entries, go, projects } = useStore();
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [story, setStory] = useState<(TimelineItem & { projectId: string })[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.timelineItems().then(setItems);
    // Scenes from the books, dated on the world's calendar.
    api.sceneIndex().then((scenes) =>
      setStory(
        scenes
          .filter((s) => s.meta.date)
          .map((s) => {
            const pov = entries.find((e) => e.id === s.meta.pov)?.title;
            const book = projects.find((p) => p.id === s.projectId)?.title ?? "";
            return { entryId: s.id, projectId: s.projectId, typeId: STORY, title: s.title, summary: [book, pov && `POV ${pov}`].filter(Boolean).join(" · "), emoji: null, fieldId: "scene", date: s.meta.date! };
          }),
      ),
    );
  }, [entries, projects]);

  const datedTypes = types.filter((t) => t.fields.some((f) => f.kind === "worlddate"));
  const fieldLabel = (it: TimelineItem) => types.find((t) => t.id === it.typeId)?.fields.find((f) => f.id === it.fieldId)?.label ?? "";

  const groups = useMemo(() => {
    const visible = [...(items ?? []), ...story]
      .filter((it) => !hidden.has(it.typeId))
      .sort((a, b) => sortKey(calendar, a.date) - sortKey(calendar, b.date) || a.title.localeCompare(b.title));
    const out: { eraId: string; items: TimelineItem[] }[] = [];
    for (const it of visible) {
      const eraId = eraOf(calendar, it.date)?.id ?? "";
      const last = out[out.length - 1];
      last && last.eraId === eraId ? last.items.push(it) : out.push({ eraId, items: [it] });
    }
    return out;
  }, [items, story, hidden, calendar]);

  const addMenu = (e: React.MouseEvent) =>
    openMenu(
      e,
      datedTypes.map((t) => ({ label: `New ${t.name.toLowerCase()}`, onClick: () => createEntry(t.id) })),
    );

  // Year shown once per run of items sharing it; the full date sits beside each item.
  const yearOf = (d: WorldDatePoint) => d.year;

  return (
    <div className="page wide timeline">
      <header className="page-head">
        <h1>Timeline</h1>
        <div className="toolbar">
          <button className="ghost" onClick={() => go({ view: "calendar" })}>
            Calendar
          </button>
          {datedTypes.length > 0 && (
            <button className="primary" onClick={addMenu}>
              Add to timeline
            </button>
          )}
        </div>
      </header>

      {(datedTypes.length > 0 || story.length > 0) && (
        <div className="timeline-filters">
          {datedTypes.map((t) => (
            <button
              key={t.id}
              className={hidden.has(t.id) ? "" : "on"}
              style={{ "--chip": t.color } as React.CSSProperties}
              onClick={() => {
                const next = new Set(hidden);
                next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                setHidden(next);
              }}
            >
              {t.plural}
            </button>
          ))}
          {story.length > 0 && (
            <button
              className={hidden.has(STORY) ? "" : "on"}
              onClick={() => {
                const next = new Set(hidden);
                next.has(STORY) ? next.delete(STORY) : next.add(STORY);
                setHidden(next);
              }}
            >
              Story
            </button>
          )}
        </div>
      )}

      {datedTypes.length === 0 && story.length === 0 ? (
        <div className="blank-slate">
          <p>
            The timeline is built from dates on your entries. Give a category a <strong>Date on the timeline</strong> field
            (an event's date, a character's birth, the founding of a faction) and everything dated appears here in order.
          </p>
          <button className="primary" onClick={() => go({ view: "schema" })}>
            Add a date field
          </button>
          {!calendar.eras.length && (
            <p className="hint">
              You can also{" "}
              <button className="link" onClick={() => go({ view: "calendar" })}>
                set up your calendar
              </button>{" "}
              first: eras, months, and how dates are written.
            </p>
          )}
        </div>
      ) : items && groups.length === 0 ? (
        <p className="page-note">Nothing dated yet. Give an entry a date and it will appear here.</p>
      ) : (
        groups.map((g, gi) => {
          const era = calendar.eras.find((e) => e.id === g.eraId);
          return (
            <section key={`${g.eraId}-${gi}`} className="era">
              {era && (
                <header className="era-head">
                  <h2>{era.name}</h2>
                  <span>{era.length ? `${era.length.toLocaleString()} years` : "Ongoing"}</span>
                </header>
              )}
              <ol className="chronicle">
                {g.items.map((it, i) => {
                  const label = fieldLabel(it);
                  const span = spanYears(calendar, it.date);
                  const newYear = i === 0 || yearOf(g.items[i - 1].date) !== yearOf(it.date);
                  const t = types.find((x) => x.id === it.typeId);
                  if (it.typeId === STORY) {
                    const scene = it as (typeof story)[number];
                    return (
                      <li key={`story-${it.entryId}`} className={`story ${newYear ? "new-year" : ""}`}>
                        <span className="chron-year">{newYear ? it.date.year : ""}</span>
                        <span className="chron-dot" />
                        <div className="chron-body">
                          <button className="link chron-title" onClick={() => go({ view: "project", id: scene.projectId, docId: it.entryId })}>
                            <BookOpen size={14} />
                            {it.title || "Untitled"}
                            <span className="chron-label">in the story</span>
                          </button>
                          <div className="chron-date">{formatDate(calendar, it.date)}</div>
                          {it.summary && <p className="chron-summary">{it.summary}</p>}
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={`${it.entryId}-${it.fieldId}`} className={newYear ? "new-year" : ""} style={{ "--chip": t?.color } as React.CSSProperties}>
                      <span className="chron-year">{newYear ? it.date.year : ""}</span>
                      <span className="chron-dot" />
                      <div className="chron-body">
                        <button className="link chron-title" onClick={() => go({ view: "entry", id: it.entryId })}>
                          <EntryGlyph entry={{ typeId: it.typeId, emoji: it.emoji, image: null }} size={14} />
                          {it.title || "Unnamed"}
                          {label && !GENERIC.has(label.toLowerCase()) && <span className="chron-label">{label.toLowerCase()}</span>}
                        </button>
                        <div className="chron-date">
                          {formatDate(calendar, it.date)}
                          {span !== null && <span> · {span === 0 ? "under a year" : `${span.toLocaleString()} year${span === 1 ? "" : "s"}`}</span>}
                        </div>
                        {it.summary && <p className="chron-summary">{it.summary}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })
      )}
    </div>
  );
}
