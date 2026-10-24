// Writing goals: a daily word goal (per computer), streaks, and the pace a book's deadline needs.

import type { WritingDay } from "./bindings";

const GOAL = "eardloom.dailyGoal";

export function getDailyGoal(): number | undefined {
  try {
    const n = Number(localStorage.getItem(GOAL));
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

export function setDailyGoal(n: number | undefined) {
  try {
    if (n) localStorage.setItem(GOAL, String(n));
    else localStorage.removeItem(GOAL);
  } catch {
    /* preference just won't persist */
  }
}

/** A local date as YYYY-MM-DD, matching the days the backend records. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
};

/** Whole days from one local date to another. */
export const daysBetween = (from: string, to: string) => {
  const t = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(to) - t(from)) / 86_400_000);
};

/** Words written each day, across all books or just one. */
export function dailyWords(days: WritingDay[], projectId?: string) {
  const out = new Map<string, number>();
  for (const d of days) if (!projectId || d.projectId === projectId) out.set(d.day, (out.get(d.day) ?? 0) + d.words);
  return out;
}

/** The last `n` days up to today, oldest first, with what was written on each. */
export function recentDays(words: Map<string, number>, today: string, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1);
    return { day, words: Math.max(0, words.get(day) ?? 0) };
  });
}

/**
 * Days in a row the goal was met (any writing at all if there's no goal). Today counts once
 * it's met, but an unmet today doesn't break a streak that ran to yesterday.
 */
export function streak(words: Map<string, number>, today: string, goal = 1) {
  const met = (day: string) => (words.get(day) ?? 0) >= Math.max(1, goal);
  let day = met(today) ? today : addDays(today, -1);
  let n = 0;
  while (met(day)) n++, (day = addDays(day, -1));
  return n;
}

/**
 * Words a day still needed to reach `target` by `deadline` (inclusive), counting today.
 * Words already written today count towards today's share.
 */
export function pace(total: number, target: number, deadline: string, today: string, writtenToday = 0) {
  const left = daysBetween(today, deadline) + 1;
  const remaining = target - (total - Math.max(0, writtenToday));
  if (remaining <= 0) return { left, perDay: 0 };
  return { left, perDay: left > 0 ? Math.ceil(remaining / left) : remaining };
}
