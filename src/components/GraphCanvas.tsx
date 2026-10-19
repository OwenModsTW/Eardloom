import { useEffect, useRef, useState } from "react";
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  color: string;
  kind: "entry" | "doc";
  /** Number of connections, for sizing. */
  degree: number;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpen: (node: GraphNode) => void;
  /** Node to centre on and emphasise. */
  focusId?: string | null;
  /** Lowercase search text; matching nodes are emphasised. */
  match?: string;
  compact?: boolean;
}

const radius = (n: GraphNode) => (n.kind === "doc" ? 3.5 : 4 + Math.sqrt(n.degree) * 2.2);
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const endpoint = (e: GraphEdge, side: "source" | "target") => e[side] as GraphNode;

/** A force-directed web of entries, drawn on a canvas so it stays smooth with thousands of nodes. */
export function GraphCanvas({ nodes, edges, onOpen, focusId, match = "", compact }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const view = useRef({ x: 0, y: 0, k: compact ? 1.1 : 0.9 });
  const hover = useRef<GraphNode | null>(null);
  const sim = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const [tip, setTip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  // Neighbours of each node, for hover highlighting.
  const neighbours = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const map = new Map<string, Set<string>>();
    for (const e of edges) {
      const s = typeof e.source === "string" ? e.source : e.source.id;
      const t = typeof e.target === "string" ? e.target : e.target.id;
      (map.get(s) ?? map.set(s, new Set()).get(s)!).add(t);
      (map.get(t) ?? map.set(t, new Set()).get(t)!).add(s);
    }
    neighbours.current = map;

    const colors = { text: css("--text"), muted: css("--muted"), line: css("--line-strong"), accent: css("--accent"), bg: css("--bg") };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
      const { x, y, k } = view.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2 + x, height / 2 + y);
      ctx.scale(k, k);

      const h = hover.current;
      const near = h ? map.get(h.id) ?? new Set<string>() : null;
      const lit = (n: GraphNode) => !h || n === h || near!.has(n.id);
      const matched = (n: GraphNode) => !!match && n.label.toLowerCase().includes(match);

      // Links
      ctx.lineWidth = 1 / k;
      for (const e of edges) {
        const s = endpoint(e, "source");
        const t = endpoint(e, "target");
        if (s.x == null || t.x == null) continue;
        const on = h && (s === h || t === h);
        ctx.strokeStyle = on ? colors.accent : colors.line;
        ctx.globalAlpha = h ? (on ? 0.9 : 0.08) : 0.55;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y!);
        ctx.lineTo(t.x, t.y!);
        ctx.stroke();
      }

      // Nodes
      for (const n of nodes) {
        if (n.x == null) continue;
        const r = radius(n);
        ctx.globalAlpha = lit(n) ? 1 : 0.15;
        ctx.fillStyle = n.color;
        ctx.beginPath();
        if (n.kind === "doc") ctx.rect(n.x - r, n.y! - r, r * 2, r * 2);
        else ctx.arc(n.x, n.y!, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.id === focusId || matched(n) || n === h) {
          ctx.lineWidth = 2 / k;
          ctx.strokeStyle = colors.accent;
          ctx.stroke();
        }
      }

      // Labels: always when zoomed in, otherwise only for what's in focus.
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = `${12 / k}px "Source Sans 3 Variable", sans-serif`;
      for (const n of nodes) {
        if (n.x == null) continue;
        const important = n === h || near?.has(n.id) || n.id === focusId || matched(n);
        const show = important || (k > (compact ? 0.9 : 1.15) && lit(n)) || (n.degree >= 6 && k > 0.6 && !h);
        if (!show) continue;
        ctx.globalAlpha = lit(n) ? (important ? 1 : 0.8) : 0.15;
        ctx.fillStyle = important ? colors.text : colors.muted;
        ctx.fillText(n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label, n.x, n.y! + radius(n) + 3 / k);
      }
      ctx.globalAlpha = 1;
    };
    drawRef.current = draw;

    const s = forceSimulation<GraphNode, GraphEdge>(nodes)
      .force("link", forceLink<GraphNode, GraphEdge>(edges).id((d) => d.id).distance(compact ? 45 : 70).strength(0.5))
      .force("charge", forceManyBody().strength(compact ? -90 : -160))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<GraphNode>((d) => radius(d) + 3))
      // A gentle pull to the middle keeps unlinked entries from drifting away.
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.05))
      .on("tick", draw);
    sim.current = s;

    // Centre the view on the focused node once the layout settles a little.
    if (focusId) {
      window.setTimeout(() => {
        const f = nodes.find((n) => n.id === focusId);
        if (f?.x != null) view.current = { ...view.current, x: -f.x * view.current.k, y: -f.y! * view.current.k };
        draw();
      }, 400);
    }

    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      s.stop();
      ro.disconnect();
    };
  }, [nodes, edges, compact]);

  useEffect(() => drawRef.current(), [match, focusId]);

  // ---- interaction: pan, zoom, drag nodes, hover, click ----
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x, y, k } = view.current;
    return { x: (clientX - rect.left - rect.width / 2 - x) / k, y: (clientY - rect.top - rect.height / 2 - y) / k };
  };
  const nodeAt = (clientX: number, clientY: number) => {
    const p = toWorld(clientX, clientY);
    let best: GraphNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      if (n.x == null) continue;
      const d = Math.hypot(n.x - p.x, n.y! - p.y);
      if (d < radius(n) + 6 / view.current.k && d < bestD) (best = n), (bestD = d);
    }
    return best;
  };

  const drag = useRef<{ node: GraphNode | null; startX: number; startY: number; moved: boolean; vx: number; vy: number } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const node = nodeAt(e.clientX, e.clientY);
    drag.current = { node, startX: e.clientX, startY: e.clientY, moved: false, vx: view.current.x, vy: view.current.y };
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      sim.current?.alphaTarget(0.25).restart();
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true;
      if (d.node) {
        const p = toWorld(e.clientX, e.clientY);
        d.node.fx = p.x;
        d.node.fy = p.y;
      } else {
        view.current = { ...view.current, x: d.vx + e.clientX - d.startX, y: d.vy + e.clientY - d.startY };
        drawRef.current();
      }
      return;
    }
    const node = nodeAt(e.clientX, e.clientY);
    if (node !== hover.current) {
      hover.current = node;
      drawRef.current();
    }
    const rect = wrapRef.current!.getBoundingClientRect();
    setTip(node ? { x: e.clientX - rect.left, y: e.clientY - rect.top, node } : null);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      sim.current?.alphaTarget(0);
      if (!d.moved) onOpen(d.node);
    }
  };
  // Native listener: React's wheel handlers can't stop the page from scrolling too.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const v = view.current;
      const k = Math.min(4, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
      // Zoom around the pointer.
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      view.current = { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      drawRef.current();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wrapRef} className={`graph-canvas ${compact ? "compact" : ""}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => ((hover.current = null), setTip(null), drawRef.current())}
        style={{ cursor: tip ? "pointer" : "grab" }}
      />
      {tip && (
        <div className="graph-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          <strong>{tip.node.label}</strong>
          <small>
            {tip.node.degree} connection{tip.node.degree === 1 ? "" : "s"}
          </small>
        </div>
      )}
    </div>
  );
}
