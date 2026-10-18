import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { newId } from "../lib/api";
import { useStore } from "../store";
import { EARTH_MONTHS, formatDate } from "../lib/calendar";
import { useAutosave } from "../lib/useAutosave";
import type { Calendar } from "../lib/types";

const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** Each world keeps its own time: named eras, and optionally months. */
export function CalendarEditor() {
  const saved = useStore((s) => s.calendar);
  const setCalendar = useStore((s) => s.setCalendar);
  const go = useStore((s) => s.go);
  const [cal, setCal] = useState<Calendar>(saved);
  const { schedule } = useAutosave(setCalendar, 400);

  const update = (patch: Partial<Calendar>) =>
    setCal((prev) => {
      const next = { ...prev, ...patch };
      schedule(next);
      return next;
    });

  const eras = cal.eras;
  const sample = eras.length
    ? { era: eras[eras.length - 1].id, year: 42, ...(cal.months.length ? { month: Math.min(2, cal.months.length - 1), day: 14 } : {}) }
    : { year: 1042, ...(cal.months.length ? { month: 0, day: 14 } : {}) };

  return (
    <div className="page calendar">
      <header className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="hint">
            How time is counted in this world. Dates are written within an era, so “Year 12 of the Second Age” stays correct
            even if you later change how long the First Age lasted.
          </p>
        </div>
        <button className="ghost" onClick={() => go({ view: "timeline" })}>
          Open timeline
        </button>
      </header>

      <section className="cal-section">
        <h2>Eras</h2>
        <p className="hint">Ages, epochs, dynasties, Bearings: the big spans your history is counted in. Leave empty to just count years.</p>
        {eras.length > 0 && (
          <div className="cal-table">
            <div className="cal-row cal-head">
              <span>Name</span>
              <span>Short form</span>
              <span>Length (years)</span>
              <span />
            </div>
            {eras.map((era, i) => (
              <div key={era.id} className="cal-row">
                <input value={era.name} placeholder="The Third Age" onChange={(e) => update({ eras: eras.map((x) => (x.id === era.id ? { ...x, name: e.target.value } : x)) })} />
                <input value={era.abbr} placeholder="TA" onChange={(e) => update({ eras: eras.map((x) => (x.id === era.id ? { ...x, abbr: e.target.value } : x)) })} />
                <input
                  inputMode="numeric"
                  value={era.length ?? ""}
                  placeholder={i === eras.length - 1 ? "Ongoing" : "e.g. 2000"}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    update({ eras: eras.map((x) => (x.id === era.id ? { ...x, length: Number.isFinite(n) && n > 0 ? n : null } : x)) });
                  }}
                />
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => update({ eras: move(eras, i, -1) })} aria-label="Earlier">
                    <ArrowUp size={13} />
                  </button>
                  <button className="icon-btn" onClick={() => update({ eras: move(eras, i, 1) })} aria-label="Later">
                    <ArrowDown size={13} />
                  </button>
                  <button className="icon-btn danger" onClick={() => update({ eras: eras.filter((x) => x.id !== era.id) })} aria-label="Remove era">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <button
          className="ghost"
          onClick={() => update({ eras: [...eras, { id: newId(), name: eras.length ? "New era" : "The First Age", abbr: "", length: null }] })}
        >
          <Plus size={14} /> Add era
        </button>
        {eras.some((e, i) => i < eras.length - 1 && !e.length) && (
          <p className="error-text">Every era except the last needs a length, so the timeline knows where the next one begins.</p>
        )}
      </section>

      <section className="cal-section">
        <h2>Months</h2>
        <p className="hint">Optional. Without months, dates are years only.</p>
        {cal.months.length > 0 && (
          <div className="cal-table months">
            {cal.months.map((m, i) => (
              <div key={i} className="cal-row">
                <input value={m.name} onChange={(e) => update({ months: cal.months.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input
                  inputMode="numeric"
                  value={m.days}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    update({ months: cal.months.map((x, j) => (j === i ? { ...x, days: Number.isFinite(n) && n > 0 ? n : 1 } : x)) });
                  }}
                />
                <span className="hint">days</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => update({ months: move(cal.months, i, -1) })} aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button className="icon-btn" onClick={() => update({ months: move(cal.months, i, 1) })} aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                  <button className="icon-btn danger" onClick={() => update({ months: cal.months.filter((_, j) => j !== i) })} aria-label="Remove month">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
            <p className="hint">{cal.months.reduce((n, m) => n + m.days, 0)} days in a year.</p>
          </div>
        )}
        <div className="row">
          <button className="ghost" onClick={() => update({ months: [...cal.months, { name: `Month ${cal.months.length + 1}`, days: 30 }] })}>
            <Plus size={14} /> Add month
          </button>
          {cal.months.length === 0 && (
            <button className="ghost" onClick={() => update({ months: EARTH_MONTHS })}>
              Use Earth's months
            </button>
          )}
          {cal.months.length > 0 && (
            <button className="link quiet" onClick={() => update({ months: [] })}>
              Remove all months
            </button>
          )}
        </div>
      </section>

      <section className="cal-section">
        <h2>Looks like</h2>
        <p className="cal-sample">{formatDate(cal, sample)}</p>
      </section>
    </div>
  );
}
