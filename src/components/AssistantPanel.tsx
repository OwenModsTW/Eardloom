import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, Plus, Sparkles, Square, X } from "lucide-react";
import { newId } from "../lib/api";
import { useStore } from "../store";
import { localAi, useLocalAi } from "../lib/localAi";
import { applyProposal } from "../lib/ai/apply";
import { useActiveEditor } from "../lib/editor/comment";
import { Markdown } from "./Markdown";
import { ProposalDetails, PROPOSAL_TITLES } from "./AiProposals";

type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; thinking: string; done: boolean }
  | { kind: "activity"; id: string; text: string }
  | { kind: "proposal"; id: string; tool: string; args: Record<string, unknown>; status: "waiting" | "applied" | "skipped" | "failed"; outcome?: string };

type ApiMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[]; tool_call_id?: string };
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const SYSTEM = `You are the assistant built into Eardloom, the author's worldbuilding and writing app, running privately on their computer.
You are here to ASSIST: help build the world, answer questions about it, review the author's writing, and make suggestions.
Never write books, chapters or scenes for the author, even if asked. Offer ideas, questions, options and brief advice instead; the writing is theirs.
Keep to what the world below establishes. If something isn't there, say so rather than inventing it, and point out contradictions you notice.
Use the tools to look things up. To change anything (new entries, entry details, comments on chapters, short line edits) use a propose tool: the author approves or skips each one.
An entry's summary is one or two sentences under its title. Descriptions, history, culture and other detail belong in its article: use add_to_article (or article for a new entry), never a long summary.
Be concise and warm. Use short paragraphs or lists.`;

const ACTIVITY: Record<string, (a: Record<string, unknown>) => string> = {
  world_overview: () => "Looked at the world overview",
  search: (a) => `Searched for “${a.query ?? ""}”`,
  list_entries: (a) => (a.category ? `Listed ${a.category}` : "Listed entries"),
  read_entry: (a) => `Read ${a.entry ?? "an entry"}`,
  read_timeline: () => "Read the timeline",
  list_books: () => "Looked at your books",
  read_chapter: () => "Read the chapter",
};

const MAX_STEPS = 6;

export function AssistantPanel() {
  const { model, thinking, setPanel } = useLocalAi();
  const { route, entries, world } = useStore();
  const activeDoc = useActiveEditor((s) => s.docId);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "waking" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [useOpen, setUseOpen] = useState(true);
  const history = useRef<ApiMessage[]>([]);
  const decisions = useRef(new Map<string, (outcome: string) => void>());
  const stopRequested = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const streamTarget = useRef<string | null>(null);

  // What the author has open, offered as context.
  const openEntry = route.view === "entry" ? entries.find((e) => e.id === route.id) : undefined;
  const openChapter = route.view === "project" ? activeDoc : null;

  useEffect(() => {
    const off = listen<{ id: string; text?: string; thinking?: string }>("local-ai://delta", (e) => {
      const target = streamTarget.current;
      if (!target || e.payload.id !== target) return;
      setItems((list) =>
        list.map((it) =>
          it.id === target && it.kind === "assistant"
            ? { ...it, text: it.text + (e.payload.text ?? ""), thinking: it.thinking + (e.payload.thinking ?? "") }
            : it,
        ),
      );
    });
    return () => void off.then((f) => f());
  }, []);

  // A new world means a new conversation.
  useEffect(() => newChat(), [world?.path]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  const newChat = () => {
    history.current = [];
    decisions.current.forEach((resolve) => resolve("The author started a new conversation."));
    decisions.current.clear();
    setItems([]);
    setError(null);
  };

  const add = (item: Item) => setItems((list) => [...list, item]);
  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? ({ ...it, ...p } as Item) : it)));

  const decide = async (item: Extract<Item, { kind: "proposal" }>, apply: boolean) => {
    const resolve = decisions.current.get(item.id);
    if (!resolve) return;
    decisions.current.delete(item.id);
    if (!apply) {
      patch(item.id, { status: "skipped" });
      return resolve("The author skipped this suggestion.");
    }
    try {
      const outcome = await applyProposal(item.tool, item.args);
      patch(item.id, { status: outcome.startsWith("Couldn't") || outcome.startsWith("There's no") ? "failed" : "applied", outcome });
      resolve(outcome);
    } catch (e) {
      patch(item.id, { status: "failed", outcome: String(e) });
      resolve(`Applying it failed: ${String(e)}`);
    }
  };

  const runTool = async (call: ToolCall): Promise<string> => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return "Those tool arguments weren't valid JSON. Try again.";
    }
    const name = call.function.name;
    if (name in ACTIVITY) {
      add({ kind: "activity", id: newId(), text: ACTIVITY[name](args) });
      try {
        return await invoke<string>("assistant_read_tool", { name, args });
      } catch (e) {
        return String(e);
      }
    }
    try {
      await invoke("assistant_check_proposal", { name, args });
    } catch (e) {
      return String(e);
    }
    const id = newId();
    add({ kind: "proposal", id, tool: name, args, status: "waiting" });
    return new Promise<string>((resolve) => decisions.current.set(id, resolve));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || state === "working" || state === "waking") return;
    setInput("");
    setError(null);
    stopRequested.current = false;
    add({ kind: "user", id: newId(), text });
    history.current.push({ role: "user", content: text });

    try {
      setState("waking");
      await localAi.start(model);
      setState("working");
      const context = await invoke<string>("assistant_context", {
        query: text,
        entryId: useOpen ? openEntry?.id ?? null : null,
        chapterId: useOpen ? openChapter : null,
      });
      const tools = await invoke<unknown[]>("assistant_tool_specs");
      const system: ApiMessage = { role: "system", content: `${SYSTEM}\n\n# The world\n${context}` };

      for (let step = 0; step < MAX_STEPS && !stopRequested.current; step++) {
        const replyId = newId();
        streamTarget.current = replyId;
        add({ kind: "assistant", id: replyId, text: "", thinking: "", done: false });
        const msg = await invoke<ApiMessage>("local_ai_chat", {
          requestId: replyId,
          body: {
            messages: [system, ...history.current],
            tools,
            temperature: 0.6,
            max_tokens: 1500,
            chat_template_kwargs: { enable_thinking: thinking },
          },
        });
        streamTarget.current = null;
        // Show exactly what came back (the stream and the final message can differ slightly).
        patch(replyId, { text: msg.content ?? "", done: true });
        // Tool-only replies have no text worth showing.
        if (!msg.content?.trim()) setItems((l) => l.filter((it) => it.id !== replyId));
        history.current.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
        if (!msg.tool_calls?.length) break;
        for (const call of msg.tool_calls) {
          const result = await runTool(call);
          history.current.push({ role: "tool", tool_call_id: call.id || call.function.name, content: result });
        }
      }
      setState("idle");
    } catch (e) {
      streamTarget.current = null;
      setError(String(e));
      setState("error");
    }
  };

  const busy = state === "working" || state === "waking";

  return (
    <aside className="assistant">
      <header className="assistant-head">
        <Sparkles size={15} />
        <strong>Assistant</strong>
        <small>on this computer</small>
        <span className="spacer" />
        <button className="icon-btn" onClick={newChat} title="New conversation">
          <Plus size={15} />
        </button>
        <button className="icon-btn" onClick={() => setPanel(false)} title="Close (Ctrl+J)">
          <X size={15} />
        </button>
      </header>

      <div className="assistant-list" ref={listRef}>
        {items.length === 0 && (
          <div className="assistant-empty">
            <p>Ask about your world, brainstorm ideas, or get feedback on a chapter.</p>
            <ul>
              <li>“Which of my characters have no connection to any faction?”</li>
              <li>“Suggest three rivals for {openEntry?.title ?? "my main character"}.”</li>
              <li>“Review the pacing of this chapter.”</li>
            </ul>
            <p className="hint">It can suggest changes, but nothing happens until you approve it. It won't write your story for you.</p>
          </div>
        )}
        {items.map((it) => {
          if (it.kind === "user") return <div key={it.id} className="msg user">{it.text}</div>;
          if (it.kind === "activity") return <div key={it.id} className="msg activity">{it.text}</div>;
          if (it.kind === "assistant")
            return (
              <div key={it.id} className="msg assistant">
                {it.thinking && !it.done && !it.text && <p className="hint">Thinking…</p>}
                {it.text ? <Markdown text={it.text} /> : !it.done && !it.thinking && <span className="typing" />}
              </div>
            );
          return (
            <article key={it.id} className={`msg proposal ${it.status}`}>
              <header>
                <Sparkles size={13} /> {PROPOSAL_TITLES[it.tool] ?? "Suggestion"}
              </header>
              <ProposalDetails tool={it.tool} args={it.args} />
              {it.status === "waiting" ? (
                <footer>
                  <button className="ghost tiny" onClick={() => decide(it, false)}>
                    Skip
                  </button>
                  <button className="primary" onClick={() => decide(it, true)}>
                    Apply
                  </button>
                </footer>
              ) : (
                <footer className="outcome">{it.status === "skipped" ? "Skipped" : it.outcome}</footer>
              )}
            </article>
          );
        })}
        {state === "waking" && <div className="msg activity">Waking the assistant… (the first time can take a little while)</div>}
        {error && <div className="msg error">{error}</div>}
      </div>

      <footer className="assistant-input">
        {(openEntry || openChapter) && (
          <button className={`context-chip ${useOpen ? "on" : ""}`} onClick={() => setUseOpen(!useOpen)} title="Include what you have open">
            {useOpen ? "Using" : "Not using"}: {openEntry ? openEntry.title || "this entry" : "this chapter"}
          </button>
        )}
        <div className="assistant-box">
          <textarea
            value={input}
            rows={2}
            placeholder="Ask your assistant…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), send());
            }}
          />
          {busy ? (
            <button className="icon-btn send" onClick={() => (stopRequested.current = true)} title="Stop after this step">
              <Square size={13} />
            </button>
          ) : (
            <button className="icon-btn send" onClick={send} disabled={!input.trim()} title="Send (Enter)">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
