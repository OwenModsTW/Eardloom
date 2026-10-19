import type { Project } from "./types";

export interface Status {
  id: string;
  name: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export const DEFAULT_STATUSES: Status[] = [
  { id: "todo", name: "To do" },
  { id: "drafting", name: "Drafting" },
  { id: "first", name: "First draft" },
  { id: "revised", name: "Revised" },
  { id: "final", name: "Final" },
];

export const LABEL_COLORS = ["#e0a458", "#c96d6d", "#5fb0c9", "#6fb58a", "#9b8bd4", "#d98fb0", "#d4b45f", "#8b9bb4"];

export interface PlanSettings {
  statuses?: Status[];
  labels?: Label[];
  targets?: Record<string, number>;
  bookTarget?: number;
}

export const planOf = (project: Project) => {
  const s = project.settings as PlanSettings;
  return { statuses: s.statuses ?? DEFAULT_STATUSES, labels: s.labels ?? [], targets: s.targets ?? {} };
};

/** How far along a status is, 0–1, for progress colouring. */
export const statusProgress = (statuses: Status[], id: string) => {
  const i = statuses.findIndex((s) => s.id === id);
  return i < 0 ? 0 : (i + 1) / statuses.length;
};
