import type { Pt } from "./model";

/** Ramer–Douglas–Peucker: drop points that don't change the shape by more than `tolerance`. */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  const sq = tolerance * tolerance;
  const distSq = (p: Pt, a: Pt, b: Pt) => {
    let [x, y] = a;
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx || dy) {
      const t = Math.max(0, Math.min(1, ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)));
      x += dx * t;
      y += dy * t;
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let index = -1;
    let max = sq;
    for (let i = first + 1; i < last; i++) {
      const d = distSq(points[i], points[first], points[last]);
      if (d > max) (index = i), (max = d);
    }
    if (index > -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A smooth SVG path through the points (Catmull–Rom as cubic Béziers). */
export function smoothPath(points: Pt[], closed: boolean, tension = 0.5): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`;
  const p = (i: number) => (closed ? points[(i + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const k = tension / 3;
    d += `C${f(p1[0] + (p2[0] - p0[0]) * k)},${f(p1[1] + (p2[1] - p0[1]) * k)} ${f(p2[0] - (p3[0] - p1[0]) * k)},${f(p2[1] - (p3[1] - p1[1]) * k)} ${f(p2[0])},${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** Small deterministic random generator, so a map's texture is the same every time. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Smooth 1D noise around a circle, built from a few random waves. */
function ringNoise(rand: () => number, octaves: number) {
  const waves = Array.from({ length: octaves }, (_, o) => ({
    freq: 2 + o * 2 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    amp: 1 / (o + 1.4),
  }));
  const total = waves.reduce((s, w) => s + w.amp, 0);
  return (angle: number) => waves.reduce((s, w) => s + Math.sin(angle * w.freq + w.phase) * w.amp, 0) / total;
}

/**
 * A random landmass outline: a wobbly ring, roughened at several scales so the
 * coast has bays and headlands.
 */
export function generateLandmass(cx: number, cy: number, rx: number, ry: number, seed: number): Pt[] {
  const rand = rng(seed);
  const coarse = ringNoise(rand, 4);
  const fine = ringNoise(rand, 7);
  const points: Pt[] = [];
  const steps = 160;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = 1 + coarse(a) * 0.38 + fine(a * 1.7) * 0.12 + (rand() - 0.5) * 0.035;
    points.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return simplify(points, 2);
}

/** Several landmasses spread over the map, larger first. */
export function generateWorld(width: number, height: number, seed: number, count: number): Pt[][] {
  const rand = rng(seed);
  const out: Pt[][] = [];
  for (let i = 0; i < count; i++) {
    const big = i === 0;
    const scale = big ? 0.3 : 0.08 + rand() * 0.12;
    const cx = width * (big ? 0.42 + rand() * 0.16 : 0.12 + rand() * 0.76);
    const cy = height * (big ? 0.42 + rand() * 0.16 : 0.15 + rand() * 0.7);
    out.push(generateLandmass(cx, cy, width * scale, height * scale * (0.8 + rand() * 0.5), Math.floor(rand() * 1e9)));
  }
  return out;
}
