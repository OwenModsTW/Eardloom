import { invoke } from "@tauri-apps/api/core";
import type { GraphEdge, GraphNode } from "../components/GraphCanvas";
import type { EntrySummary, EntryType, FieldDef } from "./types";
import { fieldsById, relationLabel } from "./relations";

export interface GraphData {
  links: { sourceKind: "entry" | "doc"; sourceId: string; targetId: string; via: string }[];
  docs: { id: string; projectId: string; title: string }[];
}

export const loadGraph = () => invoke<GraphData>("link_graph");

export interface GraphOptions {
  hiddenTypes?: Set<string>;
  includeDocs?: boolean;
  includeUnlinked?: boolean;
  /** Only show what's within `depth` links of this entry. */
  around?: { id: string; depth: number };
}

/** Turns the world's links into nodes and edges for the graph, applying filters. */
export function buildGraph(data: GraphData, entries: EntrySummary[], types: EntryType[], o: GraphOptions) {
  const visibleEntry = new Map(entries.filter((e) => !o.hiddenTypes?.has(e.typeId)).map((e) => [e.id, e]));
  const docs = new Map(data.docs.map((d) => [d.id, d]));

  const fields = fieldsById(types);
  // One line per pair, whichever way round they're linked, carrying every relationship between them.
  const pairs = new Map<string, { s: string; t: string; rel: { field: FieldDef; fromS: boolean }[] }>();
  for (const l of data.links) {
    if (!visibleEntry.has(l.targetId)) continue;
    if (l.sourceKind === "entry" && !visibleEntry.has(l.sourceId)) continue;
    if (l.sourceKind === "doc" && (!o.includeDocs || !docs.has(l.sourceId))) continue;
    const key = [l.sourceId, l.targetId].sort().join("|");
    if (!pairs.has(key)) pairs.set(key, { s: l.sourceId, t: l.targetId, rel: [] });
    const pair = pairs.get(key)!;
    const field = fields.get(l.via);
    if (field) pair.rel.push({ field, fromS: pair.s === l.sourceId });
  }
  let edges = [...pairs.values()];

  // Local graph: keep only what's within reach of the focused entry.
  let keep: Set<string> | null = null;
  if (o.around) {
    let reach = new Set<string>([o.around.id]);
    for (let i = 0; i < o.around.depth; i++) {
      const next = new Set<string>(reach);
      for (const e of edges) {
        if (reach.has(e.s)) next.add(e.t);
        if (reach.has(e.t)) next.add(e.s);
      }
      reach = next;
    }
    keep = reach;
    edges = edges.filter((e) => reach.has(e.s) && reach.has(e.t));
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.s, (degree.get(e.s) ?? 0) + 1);
    degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  for (const e of visibleEntry.values()) {
    if (keep && !keep.has(e.id)) continue;
    if (!o.includeUnlinked && !degree.has(e.id) && e.id !== o.around?.id) continue;
    nodes.push({
      id: e.id,
      label: e.title || "Unnamed",
      color: types.find((t) => t.id === e.typeId)?.color ?? "#8b9bb4",
      kind: "entry",
      degree: degree.get(e.id) ?? 0,
    });
  }
  if (o.includeDocs)
    for (const d of docs.values()) {
      if (!degree.has(d.id) || (keep && !keep.has(d.id))) continue;
      nodes.push({ id: d.id, label: d.title || "Untitled", color: "#8b9496", kind: "doc", degree: degree.get(d.id) ?? 0 });
    }

  const ids = new Set(nodes.map((n) => n.id));
  // What the other end is to each side: seen from s, t is its "Homeworld"; seen from t, s is a "Native people".
  const name = (rel: { field: FieldDef; fromS: boolean }[], fromS: boolean) =>
    [...new Set(rel.map((r) => relationLabel(r.field, r.fromS === fromS)).filter((x): x is string => !!x))].join(", ") || undefined;
  const graphEdges: GraphEdge[] = edges
    .filter((e) => ids.has(e.s) && ids.has(e.t))
    .map((e) => ({ source: e.s, target: e.t, fromSource: name(e.rel, true), fromTarget: name(e.rel, false) }));
  return { nodes, edges: graphEdges, docs };
}
