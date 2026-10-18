import type { Calendar, Era, WorldDate, WorldDatePoint } from "./types";

export const EMPTY_CALENDAR: Calendar = { eras: [], months: [] };

export const EARTH_MONTHS = [
  ["January", 31], ["February", 28], ["March", 31], ["April", 30], ["May", 31], ["June", 30],
  ["July", 31], ["August", 31], ["September", 30], ["October", 31], ["November", 30], ["December", 31],
].map(([name, days]) => ({ name: name as string, days: days as number }));

export const isWorldDate = (v: unknown): v is WorldDate =>
  !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as WorldDate).year === "number";

export function eraOf(cal: Calendar, d: WorldDatePoint): Era | undefined {
  return cal.eras.find((e) => e.id === d.era) ?? cal.eras[0];
}

/** Years elapsed before an era starts, counting all earlier eras' lengths. */
function eraOffset(cal: Calendar, era: Era | undefined) {
  if (!era) return 0;
  let years = 0;
  for (const e of cal.eras) {
    if (e.id === era.id) break;
    years += e.length ?? 0;
  }
  return years;
}

/** A single number that sorts dates chronologically across eras. */
export function sortKey(cal: Calendar, d: WorldDatePoint): number {
  const year = eraOffset(cal, eraOf(cal, d)) + d.year;
  return year * 10000 + ((d.month ?? -1) + 1) * 100 + (d.day ?? 0);
}

/** Absolute year, for measuring spans. */
export const absoluteYear = (cal: Calendar, d: WorldDatePoint) => eraOffset(cal, eraOf(cal, d)) + d.year;

function formatPoint(cal: Calendar, d: WorldDatePoint, withEra: boolean) {
  const era = eraOf(cal, d);
  const month = d.month !== undefined ? cal.months[d.month]?.name : undefined;
  const short = !!era?.abbr;
  const yearText = short ? `${d.year}` : `Year ${d.year}`;
  const monthText = month ? (d.day ? `${d.day} ${month}` : month) : "";
  // "14 March 1042 TA" with a short era name; "14 March, Year 1042, The Third Age" without.
  let text = monthText ? `${monthText}${short ? " " : ", "}${yearText}` : yearText;
  if (withEra && era) text += era.abbr ? ` ${era.abbr}` : `, ${era.name}`;
  return text;
}

/** "14 Frostmoon 1042 TA", "1042–1050, Third Bearing", "c. Year 300". */
export function formatDate(cal: Calendar, d: WorldDate | null | undefined): string {
  if (!isWorldDate(d)) return "";
  const prefix = d.approx ? "c. " : "";
  if (!d.end || !isWorldDate(d.end)) return prefix + formatPoint(cal, d, true);
  const sameEra = (eraOf(cal, d)?.id ?? "") === (eraOf(cal, d.end)?.id ?? "");
  return `${prefix}${formatPoint(cal, d, !sameEra)} – ${formatPoint(cal, d.end, true)}`;
}

/** Whole years between start and end, if the date is a span. */
export function spanYears(cal: Calendar, d: WorldDate): number | null {
  if (!d.end || !isWorldDate(d.end)) return null;
  return Math.max(0, absoluteYear(cal, d.end) - absoluteYear(cal, d));
}
