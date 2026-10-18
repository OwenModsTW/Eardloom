import { useStore } from "../store";
import { formatDate, isWorldDate } from "../lib/calendar";
import { Select } from "./Select";
import type { WorldDate, WorldDatePoint } from "../lib/types";

function PointInput({
  value,
  onChange,
}: {
  value: WorldDatePoint | null;
  onChange: (v: WorldDatePoint | null) => void;
}) {
  const cal = useStore((s) => s.calendar);
  const v = value ?? { year: NaN };
  const set = (patch: Partial<WorldDatePoint>) => {
    const next = { ...v, ...patch };
    if (!Number.isFinite(next.year)) return onChange(null);
    // Drop empty parts so stored dates stay tidy.
    if (next.month === undefined) delete next.day;
    (Object.keys(next) as (keyof WorldDatePoint)[]).forEach((k) => next[k] === undefined && delete next[k]);
    onChange(next);
  };
  const maxDay = v.month !== undefined ? cal.months[v.month]?.days : undefined;

  return (
    <div className="date-point">
      {cal.months.length > 0 && (
        <>
          <input
            className="date-day"
            inputMode="numeric"
            placeholder="Day"
            disabled={v.month === undefined}
            value={v.day ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ day: Number.isFinite(n) && n > 0 ? Math.min(n, maxDay ?? n) : undefined });
            }}
          />
          <Select
            className="inline date-month"
            value={v.month !== undefined ? String(v.month) : ""}
            placeholder="Month"
            onChange={(m) => set({ month: m === "" ? undefined : Number(m) })}
            options={[{ value: "", label: <span className="placeholder">No month</span> }, ...cal.months.map((m, i) => ({ value: String(i), label: m.name }))]}
          />
        </>
      )}
      <input
        className="date-year"
        inputMode="numeric"
        placeholder="Year"
        value={Number.isFinite(v.year) ? v.year : ""}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          set({ year: Number.isFinite(n) ? n : NaN });
        }}
      />
      {cal.eras.length > 0 && (
        <Select
          className="inline date-era"
          value={v.era ?? cal.eras[0].id}
          onChange={(era) => set({ era })}
          options={cal.eras.map((e) => ({ value: e.id, label: e.abbr || e.name, hint: e.abbr ? e.name : undefined }))}
        />
      )}
    </div>
  );
}

/** Edits a date on the world's own calendar, optionally as a span. */
export function DateInput({ value, onChange }: { value: unknown; onChange: (v: WorldDate | null) => void }) {
  const cal = useStore((s) => s.calendar);
  const go = useStore((s) => s.go);
  const date = isWorldDate(value) ? value : null;
  const legacy = !date && typeof value === "string" && value.trim() ? value : null;

  const setStart = (p: WorldDatePoint | null) => onChange(p ? { ...p, end: date?.end, approx: date?.approx } : null);

  return (
    <div className="date-input">
      <PointInput value={date} onChange={setStart} />
      {date?.end !== undefined && (
        <>
          <span className="date-to">to</span>
          <PointInput value={date.end} onChange={(end) => onChange({ ...date, end: end ?? undefined })} />
        </>
      )}
      {date && (
        <div className="date-extra">
          <button className="link quiet" onClick={() => onChange({ ...date, end: date.end ? undefined : { year: date.year, era: date.era } })}>
            {date.end ? "Remove end date" : "+ End date"}
          </button>
          <label className="date-approx">
            <input type="checkbox" checked={!!date.approx} onChange={(e) => onChange({ ...date, approx: e.target.checked || undefined })} />
            circa
          </label>
          <span className="date-preview">{formatDate(cal, date)}</span>
        </div>
      )}
      {legacy && <small className="hint">Previously written as “{legacy}”.</small>}
      {!cal.eras.length && !cal.months.length && !date && (
        <button className="link quiet" onClick={() => go({ view: "calendar" })}>
          Set up your calendar
        </button>
      )}
    </div>
  );
}
