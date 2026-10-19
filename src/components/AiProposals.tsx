import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sparkles } from "lucide-react";
import { useStore } from "../store";
import { applyProposal } from "../lib/ai/apply";

interface Proposal {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

const TITLES: Record<string, string> = {
  propose_new_entry: "New entry",
  propose_entry_changes: "Changes to an entry",
  comment_on_chapter: "Comment on your writing",
  suggest_line_edit: "Suggested line edit",
};

const resolve = (id: string, outcome: string) => invoke("assistant_resolve", { id, outcome });

function Details({ p }: { p: Proposal }) {
  const a = p.args as Record<string, string | string[] | Record<string, unknown> | undefined>;
  switch (p.tool) {
    case "propose_new_entry":
      return (
        <>
          <p className="ai-headline">
            <strong>{String(a.title ?? "")}</strong> <span className="hint">in {String(a.category ?? "")}</span>
          </p>
          {a.summary && <p className="ai-quote">{String(a.summary)}</p>}
          {a.fields && typeof a.fields === "object" && (
            <dl className="ai-fields">
              {Object.entries(a.fields as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {a.article && <p className="ai-article">{String(a.article)}</p>}
        </>
      );
    case "propose_entry_changes":
      return (
        <>
          <p className="ai-headline">
            <strong>{String(a.entry ?? "")}</strong>
          </p>
          {a.summary && (
            <p>
              <span className="hint">New summary: </span>
              {String(a.summary)}
            </p>
          )}
          {a.fields && typeof a.fields === "object" && (
            <dl className="ai-fields">
              {Object.entries(a.fields as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {Array.isArray(a.add_aliases) && a.add_aliases.length > 0 && <p className="hint">Also known as: {a.add_aliases.join(", ")}</p>}
          {Array.isArray(a.add_tags) && a.add_tags.length > 0 && <p className="hint">Tags: {a.add_tags.join(", ")}</p>}
          {a.add_to_article && (
            <p className="ai-article">
              <span className="hint">Add to article: </span>
              {String(a.add_to_article)}
            </p>
          )}
        </>
      );
    case "comment_on_chapter":
      return (
        <>
          <p className="ai-quote">“{String(a.quote ?? "")}”</p>
          <p>{String(a.note ?? "")}</p>
        </>
      );
    case "suggest_line_edit":
      return (
        <>
          <p className="ai-diff">
            <del>{String(a.original ?? "")}</del>
            <ins>{String(a.replacement ?? "")}</ins>
          </p>
          {a.reason && <p className="hint">{String(a.reason)}</p>}
        </>
      );
    default:
      return null;
  }
}

/** Changes proposed by a connected AI app, waiting for the author's decision. */
export function AiProposals() {
  const [queue, setQueue] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const notify = useStore((s) => s.notify);

  useEffect(() => {
    const offProposal = listen<Proposal>("ai://proposal", (e) => setQueue((q) => [...q, e.payload]));
    const offClient = listen<string>("ai://client", (e) => notify(`${e.payload} connected to your world`));
    return () => {
      offProposal.then((f) => f());
      offClient.then((f) => f());
    };
  }, [notify]);

  if (!queue.length) return null;

  const done = (id: string) => setQueue((q) => q.filter((p) => p.id !== id));
  const apply = async (p: Proposal) => {
    setBusy(p.id);
    try {
      const outcome = await applyProposal(p.tool, p.args);
      await resolve(p.id, outcome);
      notify(outcome.split(" Notes:")[0]);
    } catch (e) {
      await resolve(p.id, `Applying it failed: ${String(e)}`);
      notify(`Couldn't apply: ${String(e)}`);
    } finally {
      setBusy(null);
      done(p.id);
    }
  };
  const skip = async (p: Proposal) => {
    await resolve(p.id, "The author skipped this suggestion.");
    done(p.id);
  };

  return (
    <div className="ai-proposals" role="region" aria-label="AI suggestions">
      {queue.map((p) => (
        <article key={p.id} className="ai-card">
          <header>
            <Sparkles size={14} />
            <span>{TITLES[p.tool] ?? "Suggestion"}</span>
            <small>from your AI assistant</small>
          </header>
          <div className="ai-card-body">
            <Details p={p} />
          </div>
          <footer>
            <button className="ghost tiny" disabled={busy === p.id} onClick={() => skip(p)}>
              Skip
            </button>
            <button className="primary" disabled={busy === p.id} onClick={() => apply(p)}>
              {busy === p.id ? "Applying…" : "Apply"}
            </button>
          </footer>
        </article>
      ))}
    </div>
  );
}
