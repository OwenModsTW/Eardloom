import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useStore } from "../store";
import { buildGraph, loadGraph, type GraphData } from "../lib/graph";
import { GraphCanvas, type GraphNode } from "./GraphCanvas";

/** The whole world as a web of connections. */
export function GraphView({ focus }: { focus?: string }) {
  const { entries, types, go } = useStore();
  const [data, setData] = useState<GraphData | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [includeDocs, setIncludeDocs] = useState(false);
  const [includeUnlinked, setIncludeUnlinked] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    loadGraph().then(setData);
  }, [entries]);

  const graph = useMemo(
    () => (data ? buildGraph(data, entries, types, { hiddenTypes: hidden, includeDocs, includeUnlinked }) : null),
    [data, entries, types, hidden, includeDocs, includeUnlinked],
  );

  const open = (n: GraphNode) => {
    if (n.kind === "entry") go({ view: "entry", id: n.id });
    else {
      const d = graph?.docs.get(n.id);
      if (d) go({ view: "project", id: d.projectId, docId: d.id });
    }
  };

  return (
    <div className="graph-page">
      <header className="graph-bar">
        <h1>Graph</h1>
        <label className="search-inline">
          <Search size={13} />
          <input placeholder="Find" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="timeline-filters">
          {types.map((t) => (
            <button
              key={t.id}
              className={hidden.has(t.id) ? "" : "on"}
              style={{ "--chip": t.color } as React.CSSProperties}
              onClick={() => {
                const next = new Set(hidden);
                next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                setHidden(next);
              }}
            >
              {t.plural}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <label className="check inline-check">
          <input type="checkbox" checked={includeUnlinked} onChange={(e) => setIncludeUnlinked(e.target.checked)} />
          <span>Unlinked</span>
        </label>
        <label className="check inline-check">
          <input type="checkbox" checked={includeDocs} onChange={(e) => setIncludeDocs(e.target.checked)} />
          <span>Chapters</span>
        </label>
        {graph && (
          <span className="hint graph-count">
            {graph.nodes.length} · {graph.edges.length} links
          </span>
        )}
      </header>
      {graph && graph.nodes.length > 0 ? (
        <GraphCanvas nodes={graph.nodes} edges={graph.edges} onOpen={open} focusId={focus} match={query.trim().toLowerCase()} />
      ) : (
        graph && (
          <p className="page-note">
            Nothing to draw yet. Link entries with @mentions or link fields and they'll appear here, joined together.
          </p>
        )
      )}
    </div>
  );
}

/** A small graph of what's connected to one entry, for its page. */
export function LocalGraph({ id }: { id: string }) {
  const { entries, types, go } = useStore();
  const [data, setData] = useState<GraphData | null>(null);
  const [depth, setDepth] = useState(1);
  useEffect(() => {
    loadGraph().then(setData);
  }, [entries, id]);
  const graph = useMemo(
    () => (data ? buildGraph(data, entries, types, { includeUnlinked: true, around: { id, depth } }) : null),
    [data, entries, types, id, depth],
  );
  if (!graph || graph.nodes.length < 2) return null;
  return (
    <section className="local-graph">
      <h3>
        Connections
        <span className="spacer" />
        <button className="link quiet" onClick={() => setDepth(depth === 1 ? 2 : 1)}>
          {depth === 1 ? "Show 2 steps" : "Show 1 step"}
        </button>
        <button className="link quiet" onClick={() => go({ view: "graph", focus: id })}>
          Open graph
        </button>
      </h3>
      <GraphCanvas compact nodes={graph.nodes} edges={graph.edges} focusId={id} onOpen={(n) => n.id !== id && go({ view: "entry", id: n.id })} />
    </section>
  );
}
