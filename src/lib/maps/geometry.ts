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
 * Fractal coastline: repeatedly push each edge's midpoint sideways by a random
 * amount proportional to its length, giving bays within bays like a real coast.
 */
function roughen(points: Pt[], rand: () => number, iterations: number, strength: number): Pt[] {
  let pts = points;
  let s = strength;
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const off = (rand() - 0.5) * s;
      // Offset along the edge's normal.
      next.push(a, [a[0] + dx / 2 - dy * off, a[1] + dy / 2 + dx * off]);
    }
    pts = next;
    s *= 0.62;
  }
  return pts;
}

/**
 * A random landmass outline: a wobbly ring for the overall shape, then fractal
 * roughening for headlands, inlets and coves.
 */
export function generateLandmass(cx: number, cy: number, rx: number, ry: number, seed: number): Pt[] {
  const rand = rng(seed);
  const coarse = ringNoise(rand, 5);
  const ring: Pt[] = [];
  // Few, strongly varied control points give peninsulas and gulfs.
  const steps = 18;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = Math.max(0.35, 1 + coarse(a) * 0.62 + (rand() - 0.5) * 0.18);
    ring.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  // Gentle first passes avoid spikes where the coast would cross itself.
  return simplify(roughen(ring, rand, 6, 0.5), Math.max(rx, ry) / 500);
}

/** Scales a shape about its centre so it fits inside the map with a margin. */
function fitInside(points: Pt[], width: number, height: number, margin: number): Pt[] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const s = Math.min(1, (width / 2 - margin) / Math.max(1, cx - x0, x1 - cx), (height / 2 - margin) / Math.max(1, cy - y0, y1 - cy));
  // Shrink if needed, then nudge back on to the map.
  let pts: Pt[] = points.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
  const nx0 = cx - (cx - x0) * s;
  const nx1 = cx + (x1 - cx) * s;
  const ny0 = cy - (cy - y0) * s;
  const ny1 = cy + (y1 - cy) * s;
  const dx = nx0 < margin ? margin - nx0 : nx1 > width - margin ? width - margin - nx1 : 0;
  const dy = ny0 < margin ? margin - ny0 : ny1 > height - margin ? height - margin - ny1 : 0;
  if (dx || dy) pts = pts.map(([x, y]) => [x + dx, y + dy]);
  return pts;
}

/** Several landmasses spread over the map, larger first. */
export function generateWorld(width: number, height: number, seed: number, count: number): Pt[][] {
  const rand = rng(seed);
  const out: Pt[][] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  // With several landmasses, the first is the largest but leaves room for the rest.
  const mainScale = count === 1 ? 0.3 : count === 2 ? 0.2 : 0.22;
  for (let i = 0; i < count; i++) {
    const big = i === 0;
    const scale = big ? mainScale : 0.06 + rand() * 0.08;
    const rx = width * scale;
    const ry = height * scale * (0.8 + rand() * 0.5);
    // Try a few spots and keep the first that doesn't crowd an earlier landmass
    // (coasts reach out ~1.5× the radius at their headlands).
    let spot: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 40 && !spot; attempt++) {
      const x = width * (big && count === 1 ? 0.42 + rand() * 0.16 : 0.15 + rand() * 0.7);
      const y = height * (big && count === 1 ? 0.42 + rand() * 0.16 : 0.18 + rand() * 0.64);
      const r = Math.max(rx, ry);
      if (placed.every((p) => Math.hypot(p.x - x, p.y - y) > (p.r + r) * 1.45)) spot = { x, y };
    }
    if (!spot) continue;
    placed.push({ ...spot, r: Math.max(rx, ry) });
    out.push(fitInside(generateLandmass(spot.x, spot.y, rx, ry, Math.floor(rand() * 1e9)), width, height, Math.min(width, height) * 0.04));
  }
  return out;
}
