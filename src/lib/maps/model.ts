export type Pt = [number, number];

export type MapStyle = "parchment" | "atlas" | "starchart";

export type AreaKind = "land" | "region" | "lake" | "forest";
export type LineKind = "river" | "road" | "route" | "border";

export interface Area {
  id: string;
  kind: AreaKind;
  points: Pt[];
  /** Regions only: fill colour. */
  color?: string;
}

export interface Line {
  id: string;
  kind: LineKind;
  points: Pt[];
}

export interface MapSymbol {
  id: string;
  icon: string;
  x: number;
  y: number;
  size: number;
}

export interface MapLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  kind: "region" | "place" | "water";
}

export interface Pin {
  id: string;
  x: number;
  y: number;
  entryId?: string;
  /** A pin can open another map (galaxy → system → planet). */
  mapId?: string;
  label?: string;
}

export interface MapData {
  style: MapStyle;
  areas: Area[];
  lines: Line[];
  symbols: MapSymbol[];
  labels: MapLabel[];
  pins: Pin[];
  /** Random seed for decorative texture (stars, paper grain). */
  seed: number;
}

export interface WorldMap {
  id: string;
  title: string;
  image: string | null;
  width: number;
  height: number;
  sort: number;
  data: MapData;
  updatedAt?: string;
}

export const emptyData = (style: MapStyle): MapData => ({
  style,
  areas: [],
  lines: [],
  symbols: [],
  labels: [],
  pins: [],
  seed: Math.floor(Math.random() * 1e9),
});

/** Older or partial data is filled in so the editor can rely on every list existing. */
export const normaliseData = (d: Partial<MapData> | undefined, fallback: MapStyle = "parchment"): MapData => ({
  ...emptyData(d?.style ?? fallback),
  ...d,
  areas: d?.areas ?? [],
  lines: d?.lines ?? [],
  symbols: d?.symbols ?? [],
  labels: d?.labels ?? [],
  pins: d?.pins ?? [],
});
