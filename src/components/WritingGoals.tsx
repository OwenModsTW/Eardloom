import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../store";
import type { WritingOverview } from "../lib/bindings";
import type { Project } from "../lib/types";
import { dailyWords, daysBetween, getDailyGoal, localDay, pace, recentDays, setDailyGoal, streak } from "../lib/goals";

type BookGoals = { bookTarget?: number; deadline?: string };

const shortDate = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(y !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};

/** "628 words a day by 1 Mar · 129 days left", or how it stands once the date or target is reached. */
function paceLine(total: number, goals: BookGoals, today: string, writtenToday: number, short = false) {
  if (!goals.bookTarget || !goals.deadline) return null;
  if (total >= goals.bookTarget) return "Target reached";
  const { left, perDay } = pace(total, goals.bookTarget, goals.deadline, today, writtenToday);
  if (left <= 0) return `Deadline passed · ${(goals.bookTarget - total).toLocaleString()} words to go`;
  const due = left === 1 ? "today" : `by ${shortDate(goals.deadline)}`;
  return `${perDay.toLocaleString()} words a day ${due}${short ? "" : ` · ${left} ${left === 1 ? "day" : "days"} left`}`;
}

export function TargetMeter({ words, target, onChange, label }: { words: number; target?: number; onChange: (n: number | undefined) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        className="target-input"
        autoFocus
        inputMode="numeric"
        defaultValue={target ?? ""}
        placeholder="Words"
        onBlur={(e) => {
          const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
          onChange(Number.isFinite(n) && n > 0 ? n : undefined);
          setEditing(false);
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
      />
    );
  if (!target)
    return (
      <button className="link quiet" onClick={() => setEditing(true)}>
        Set {label} target
      </button>
    );
  const pct = Math.min(100, Math.round((words / target) * 100));
  return (
    <button className={`target ${pct >= 100 ? "done" : ""}`} onClick={() => setEditing(true)} title={`${label} target: click to change`}>
      <span className="target-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      {pct}% of {target.toLocaleString()}
    </button>
  );
}

/** The dashboard's writing panel: today against the daily goal, the streak, the last month, and deadlines. */
export function TodayPanel({ overview, projects }: { overview: WritingOverview; projects: Project[] }) {
  const go = useStore((s) => s.go);
  const [goal, setGoal] = useState(getDailyGoal);
  const today = localDay(new Date());
  const words = useMemo(() => dailyWords(overview.days), [overview]);
  const month = useMemo(() => recentDays(words, today, 30), [words, today]);
  const written = Math.max(0, words.get(today) ?? 0);
  const run = streak(words, today, goal);
  const tallest = Math.max(goal ?? 0, ...month.map((d) => d.words), 1);

  const deadlines = projects
    .map((p) => {
      const total = overview.totals.find((t) => t.projectId === p.id)?.words ?? 0;
      const line = paceLine(total, p.settings as BookGoals, today, Math.max(0, dailyWords(overview.days, p.id).get(today) ?? 0));
      return line && { p, line };
    })
    .filter((d) => !!d);

  return (
    <section className="panel writing-today">
      <h2>Today</h2>
      <div className="today-count">
        <strong>{written.toLocaleString()}</strong>
        <span>{written === 1 ? "word" : "words"}</span>
        {run > 0 && (
          <small className="streak" title={goal ? "Days in a row you've met your daily goal" : "Days in a row you've written"}>
            {run}-day streak
          </small>
        )}
      </div>
      <TargetMeter label="daily" words={written} target={goal} onChange={(n) => (setDailyGoal(n), setGoal(n))} />
      <div className="today-bars" aria-label="Words written over the last 30 days">
        {month.map((d) => (
          <span
            key={d.day}
            className={`${goal && d.words >= goal ? "met" : ""} ${d.day === today ? "today" : ""}`}
            style={{ height: `${Math.max(d.words ? 6 : 2, (d.words / tallest) * 100)}%` }}
            title={`${shortDate(d.day)}: ${d.words.toLocaleString()} words`}
          />
        ))}
        {goal && <i className="goal-line" style={{ bottom: `${(goal / tallest) * 100}%` }} />}
      </div>
      <p className="panel-note today-legend">
        <span>Last 30 days</span>
        <span>{month.reduce((n, d) => n + d.words, 0).toLocaleString()} words</span>
      </p>
      {deadlines.length > 0 && (
        <ul className="recent deadlines">
          {deadlines.map(({ p, line }) => (
            <li key={p.id}>
              <button className="link" onClick={() => go({ view: "project", id: p.id })}>
                {p.title || "Untitled"}
              </button>
              <small>{line}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Under the book's target in the binder: a finish-by date and the pace it needs. */
export function BookDeadline({ project, total, onChange }: { project: Project; total: number; onChange: (deadline: string | undefined) => void }) {
  const goals = project.settings as BookGoals;
  const [editing, setEditing] = useState(false);
  const [todayWords, setTodayWords] = useState(0);
  const today = localDay(new Date());
  useEffect(() => {
    api.writingOverview().then((o) => setTodayWords(Math.max(0, dailyWords(o.days, project.id).get(today) ?? 0)));
  }, [project.id, total, today]);

  if (!goals.bookTarget) return null;
  if (editing)
    return (
      <input
        className="target-input date"
        type="date"
        autoFocus
        min={today}
        defaultValue={goals.deadline ?? ""}
        onBlur={(e) => {
          onChange(e.target.value || undefined);
          setEditing(false);
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
      />
    );
  if (!goals.deadline)
    return (
      <button className="link quiet" onClick={() => setEditing(true)}>
        Set a finish date
      </button>
    );
  const late = daysBetween(today, goals.deadline) < 0 && total < goals.bookTarget;
  return (
    <button
      className={`deadline ${late ? "late" : ""}`}
      onClick={() => setEditing(true)}
      title={`${paceLine(total, goals, today, todayWords)}. Click to change the finish date.`}
    >
      {paceLine(total, goals, today, todayWords, true)}
    </button>
  );
}
