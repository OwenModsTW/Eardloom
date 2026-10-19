import type { MapStyle } from "./model";

export interface StyleDef {
  label: string;
  blurb: string;
  sea: string;
  seaDeep: string;
  land: string;
  coast: string;
  ink: string;
  muted: string;
  forest: string;
  lake: string;
  river: string;
  road: string;
  border: string;
  labelFont: string;
  /** Faint concentric lines around coasts. */
  ripples: boolean;
  /** Star field and grid instead of sea texture. */
  space: boolean;
}

export const MAP_STYLES: Record<MapStyle, StyleDef> = {
  parchment: {
    label: "Parchment",
    blurb: "Inked coasts on aged paper. Fantasy and history.",
    sea: "#d8d6c4",
    seaDeep: "#c5c7b4",
    land: "#efe3c4",
    coast: "#4a3a26",
    ink: "#3b2e1e",
    muted: "#7a6a52",
    forest: "#8f9a68",
    lake: "#cdd3c2",
    river: "#5d7a86",
    road: "#7a5a3a",
    border: "#8a3f35",
    labelFont: '"Literata Variable", Georgia, serif',
    ripples: true,
    space: false,
  },
  atlas: {
    label: "Atlas",
    blurb: "Clean modern cartography. Contemporary and near-future.",
    sea: "#b9d7e6",
    seaDeep: "#9cc3d8",
    land: "#eef1e1",
    coast: "#5d7d8c",
    ink: "#26343a",
    muted: "#62757d",
    forest: "#b7cfa0",
    lake: "#b9d7e6",
    river: "#4f8fb0",
    road: "#c06a4a",
    border: "#7b5ea7",
    labelFont: '"Source Sans 3 Variable", "Segoe UI", sans-serif',
    ripples: false,
    space: false,
  },
  starchart: {
    label: "Starchart",
    blurb: "Deep space, sectors and routes. Science fiction.",
    sea: "#0b1220",
    seaDeep: "#070c16",
    land: "#1b5e5540",
    coast: "#2a8a6c",
    ink: "#d9e6e3",
    muted: "#7f9a96",
    forest: "#6c4fa540",
    lake: "#3a6fa540",
    river: "#5fb0c9",
    road: "#f6bd60",
    border: "#e4826f",
    labelFont: '"Source Sans 3 Variable", "Segoe UI", sans-serif',
    ripples: false,
    space: true,
  },
};

export const REGION_COLORS = ["#c96d6d", "#5fb0c9", "#6fb58a", "#d4b45f", "#9b8bd4", "#d98fb0"];
