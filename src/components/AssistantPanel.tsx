import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, BookOpen, Globe, RotateCcw, ScrollText, Sparkles, Square, Undo2, X } from "lucide-react";
import { api, newId } from "../lib/api";
import { useStore } from "../store";
import { localAi, useLocalAi } from "../lib/localAi";
import { applyProposal, restoreEntry } from "../lib/ai/apply";
import { useActiveEditor } from "../lib/editor/comment";
import { Markdown } from "./Markdown";
import { ProposalDetails, PROPOSAL_TITLES } from "./AiProposals";
import type { Entry } from "../lib/types";

type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; thinking: string; done: boolean }
  | { kind: "activity"; id: string; text: string }
  | {
      kind: "proposal";
      id: string;
      tool: string;
      args: Record<string, unknown>;
      status: "waiting" | "applied" | "skipped" | "failed";
      outcome?: string;
      /** The entry as it was before this change, so it can be undone. */
      undo?: Entry;
      undone?: boolean;
    };

type ApiMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[]; tool_call_id?: string };
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A conversation as it's saved in the world. */
interface Saved {
  items: Item[];
  history: ApiMessage[];
  /** Things that happened since the assistant last spoke, told to it with the next message. */
  notes?: string[];
}

const SYSTEM = `You are the assistant built into Eardloom, the author's worldbuilding and writing app, running privately on their computer.
You help with two things, under different rules:
- LORE (the codex: entries for characters, places, peoples, history, magic, technology and so on): you're a full collaborator. When asked, write or rewrite complete entry articles, fill in fields, and propose new entries. Build on what the world establishes and flag anything that contradicts it.
- STORY (the author's books and chapters): the writing is theirs alone. Never write or continue chapters, scenes, dialogue or narrative prose, even if asked; politely say so. You may review, comment, ask questions, discuss ideas and suggest short line edits.
Use the tools to look things up. To change anything use a propose tool; the author approves or skips each one.
For entries: the summary is one or two sentences under the title. Descriptions, history, culture and other detail go in the article: add_to_article adds to it, rewrite_article replaces it (use that when asked to rewrite, restructure or expand the whole thing), and a new entry takes article. Articles can use Markdown headings (##), lists and bold.
Be concise and warm in conversation.`;

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
/** Roughly how much earlier conversation is sent with each question (characters); the world context takes the rest. */
const SEND_BUDGET = 12_000;
/** How much of a conversation is kept in the world. */
const KEEP_BUDGET = 40_000;
const KEEP_ITEMS = 200;

const size = (m: ApiMessage) => m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);

/** The most recent part of a conversation that fits the budget, always starting at one of the author's messages. */
function recent(history: ApiMessage[], budget: number): ApiMessage[] {
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0 && lastUser < 0; i--) if (history[i].role === "user") lastUser = i;
  if (lastUser < 0) return [];
  let start = lastUser;
  let total = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    total += size(history[i]);
    if (total > budget) break;
    if (history[i].role === "user") start = i;
  }
  return history.slice(Math.min(start, lastUser));
}

/** Tidies a conversation saved mid-reply: every tool call gets an answer and nothing is left "typing". */
function repair(saved: Saved): Saved {
  const history: ApiMessage[] = [];
  saved.history.forEach((m, i) => {
    history.push(m);
    if (m.role !== "assistant" || !m.tool_calls?.length) return;
    const answered = new Set(saved.history.slice(i + 1).filter((t) => t.role === "tool").map((t) => t.tool_call_id));
    for (const call of m.tool_calls) {
      const id = call.id || call.function.name;
      if (!answered.has(id)) history.push({ role: "tool", tool_call_id: id, content: "The conversation was closed before this finished." });
    }
  });
  const items = saved.items
    .map((it) => (it.kind === "assistant" ? { ...it, thinking: "", done: true } : it))
    .filter((it) => it.kind !== "assistant" || it.text.trim());
  return { items, history, notes: saved.notes ?? [] };
}

function subjectOf(entryId: string | undefined, docId: string | null) {
  return entryId ? `entry:${entryId}` : docId ? `doc:${docId}` : "world";
}

function when(updatedAt: string) {
  const d = new Date(updatedAt.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function AssistantPanel() {
  const { model, thinking, setPanel } = useLocalAi();
  const { route, entries, world } = useStore();
  const activeDoc = useActiveEditor((s) => s.docId);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "waking" | "working" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [earlier, setEarlier] = useState<{ count: number; at: string } | null>(null);
  const history = useRef<ApiMessage[]>([]);
  const notes = useRef<string[]>([]);
  const decisions = useRef(new Map<string, (outcome: string) => void>());
  const stopRequested = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const streamTarget = useRef<string | null>(null);
  /** Which world and subject `items` belongs to; saving waits until it's loaded. */
  const loaded = useRef<{ world: string; subject: string } | null>(null);
  const lastSaved = useRef("");
  const pendingSave = useRef<{ timer: number; run: () => void } | null>(null);

  // Each entry and chapter has its own conversation; anywhere else it's about the world as a whole.
  const openEntry = route.view === "entry" ? entries.find((e) => e.id === route.id) : undefined;
  const openChapter = route.view === "project" ? activeDoc : null;
  const wanted = subjectOf(openEntry?.id, openChapter);
  const busy = state === "working" || state === "waking";

  const subjectEntry = subject?.startsWith("entry:") ? entries.find((e) => e.id === subject.slice(6)) : undefined;
  const subjectLabel = subject?.startsWith("entry:")
    ? subjectEntry?.title || "This entry"
    : subject?.startsWith("doc:")
      ? chapterTitle || "This chapter"
      : world?.name ?? "Your world";

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

  const flushSave = () => {
    const pending = pendingSave.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSave.current = null;
    pending.run();
  };

  // Switch to the conversation for what's open (never in the middle of a reply).
  useEffect(() => {
    const worldPath = world?.path;
    if (!worldPath || busy) return;
    if (loaded.current?.world === worldPath && loaded.current.subject === wanted) return;
    if (loaded.current?.world === worldPath) flushSave();
    else if (pendingSave.current) (clearTimeout(pendingSave.current.timer), (pendingSave.current = null));
    loaded.current = null;
    decisions.current.clear();
    setState("loading");
    setError(null);
    setSubject(wanted);
    invoke<{ data: string; updated_at: string } | null>("assistant_chat_load", { subject: wanted })
      .then((row) => {
        if (useStore.getState().world?.path !== worldPath) return;
        let saved: Saved = { items: [], history: [] };
        try {
          if (row) saved = repair(JSON.parse(row.data));
        } catch {
          /* an unreadable conversation starts afresh */
        }
        history.current = saved.history;
        notes.current = saved.notes ?? [];
        setItems(saved.items);
        setEarlier(row && saved.items.length ? { count: saved.items.length, at: when(row.updated_at) } : null);
        lastSaved.current = row?.data ?? "";
        loaded.current = { world: worldPath, subject: wanted };
        setState("idle");
      })
      .catch((e) => {
        setError(String(e));
        setState("error");
      });
  }, [wanted, world?.path, busy]);

  useEffect(() => {
    if (!subject?.startsWith("doc:")) return setChapterTitle("");
    api.getDoc(subject.slice(4)).then((d) => setChapterTitle(d.title), () => setChapterTitle(""));
  }, [subject]);

  // Save as the conversation goes, a moment after it settles.
  useEffect(() => {
    const target = loaded.current;
    if (!target || items.length === 0) return;
    const saved: Saved = {
      items: items.slice(-KEEP_ITEMS).map((it) => (it.kind === "assistant" ? { ...it, thinking: "" } : it)),
      history: recent(history.current, KEEP_BUDGET),
      notes: notes.current,
    };
    const data = JSON.stringify(saved);
    if (data === lastSaved.current) return;
    if (pendingSave.current) clearTimeout(pendingSave.current.timer);
    const run = () => {
      if (useStore.getState().world?.path !== target.world) return;
      lastSaved.current = data;
      invoke("assistant_chat_save", { subject: target.subject, data }).catch(() => {});
    };
    pendingSave.current = { run, timer: window.setTimeout(() => ((pendingSave.current = null), run()), 600) };
  }, [items, state]);

  // Don't lose the last few words if the panel closes.
  useEffect(() => () => flushSave(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  const startOver = () => {
    const target = loaded.current;
    if (!target || busy) return;
    if (pendingSave.current) (clearTimeout(pendingSave.current.timer), (pendingSave.current = null));
    history.current = [];
    notes.current = [];
    decisions.current.clear();
    setItems([]);
    setEarlier(null);
    setError(null);
    lastSaved.current = "";
    invoke("assistant_chat_clear", { subject: target.subject }).catch(() => {});
  };

  const add = (item: Item) => setItems((list) => [...list, item]);
  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? ({ ...it, ...p } as Item) : it)));

  const decide = async (item: Extract<Item, { kind: "proposal" }>, apply: boolean) => {
    const waiting = decisions.current.get(item.id);
    decisions.current.delete(item.id);
    // A suggestion from an earlier session: the assistant hears about it with the next message.
    const resolve = waiting ?? ((outcome: string) => notes.current.push(`${PROPOSAL_TITLES[item.tool] ?? "Suggestion"}: ${outcome}`));
    const keep = (entry: Entry) => patch(item.id, { undo: entry });
    if (!apply) {
      patch(item.id, { status: "skipped" });
      return resolve("The author skipped this suggestion.");
    }
    try {
      const outcome = await applyProposal(item.tool, item.args, keep);
      patch(item.id, { status: outcome.startsWith("Couldn't") || outcome.startsWith("There's no") ? "failed" : "applied", outcome });
      resolve(outcome);
    } catch (e) {
      patch(item.id, { status: "failed", outcome: String(e) });
      resolve(`Applying it failed: ${String(e)}`);
    }
  };

  const undo = async (item: Extract<Item, { kind: "proposal" }>) => {
    if (!item.undo) return;
    try {
      const outcome = await restoreEntry(item.undo);
      patch(item.id, { undone: true, outcome });
      notes.current.push(`The author undid your change to "${item.undo.title}".`);
    } catch (e) {
      setError(`Couldn't undo: ${String(e)}`);
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
    const target = subject;
    if (!text || !target || (state !== "idle" && state !== "error")) return;
    setInput("");
    setError(null);
    stopRequested.current = false;
    add({ kind: "user", id: newId(), text });
    const since = notes.current.length ? `(Since we last spoke: ${notes.current.join(" ")})\n\n` : "";
    notes.current = [];
    history.current.push({ role: "user", content: since + text });

    try {
      setState("waking");
      await localAi.start(model);
      setState("working");
      const context = await invoke<string>("assistant_context", {
        query: text,
        entryId: target.startsWith("entry:") ? target.slice(6) : null,
        chapterId: target.startsWith("doc:") ? target.slice(4) : null,
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
            messages: [system, ...recent(history.current, SEND_BUDGET)],
            tools,
            temperature: 0.6,
            max_tokens: 3000,
            chat_template_kwargs: { enable_thinking: thinking },
          },
        });
        streamTarget.current = null;
        history.current.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
        // Show exactly what came back (the stream and the final message can differ slightly).
        patch(replyId, { text: msg.content ?? "", done: true });
        // Tool-only replies have no text worth showing.
        if (!msg.content?.trim()) setItems((l) => l.filter((it) => it.id !== replyId));
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

  const SubjectIcon = subject?.startsWith("entry:") ? ScrollText : subject?.startsWith("doc:") ? BookOpen : Globe;

  const renderItem = (it: Item) => {
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
          <footer className="outcome">
            <span>{it.status === "skipped" ? "Skipped" : it.outcome}</span>
            {it.undo && it.status === "applied" && !it.undone && (
              <button className="ghost tiny" onClick={() => undo(it)} disabled={busy} title="Put the entry back as it was before this change">
                <Undo2 size={12} /> Undo
              </button>
            )}
          </footer>
        )}
      </article>
    );
  };

  return (
    <aside className="assistant">
      <header className="assistant-head">
        <Sparkles size={15} />
        <strong>Assistant</strong>
        <small>on this computer</small>
        <span className="spacer" />
        <button className="icon-btn" onClick={startOver} disabled={busy || items.length === 0} title="Start this conversation over">
          <RotateCcw size={14} />
        </button>
        <button className="icon-btn" onClick={() => setPanel(false)} title="Close (Ctrl+J)">
          <X size={15} />
        </button>
      </header>

      <div className="assistant-subject">
        <SubjectIcon size={13} />
        <span>
          Talking about <strong>{subjectLabel}</strong>
        </span>
        {busy && subject !== wanted && <small>finishing up</small>}
      </div>

      <div className="assistant-list" ref={listRef}>
        {state !== "loading" && items.length === 0 && (
          <div className="assistant-empty">
            <p>
              {subject?.startsWith("entry:")
                ? `Brainstorm, ask questions or get feedback on ${subjectLabel}. This conversation stays with the entry, so you can pick it up any time.`
                : subject?.startsWith("doc:")
                  ? "Get feedback on this chapter or talk through what happens next. This conversation stays with the chapter."
                  : "Ask about your world as a whole. Open an entry or chapter to talk about that one; each keeps its own conversation."}
            </p>
            <ul>
              {subject?.startsWith("doc:") ? (
                <>
                  <li>“Review the pacing of this chapter.”</li>
                  <li>“Does anything here contradict my codex?”</li>
                </>
              ) : (
                <>
                  <li>“Which of my characters have no connection to any faction?”</li>
                  <li>“Suggest three rivals for {subjectEntry?.title ?? "my main character"}.”</li>
                </>
              )}
            </ul>
            <p className="hint">It can write lore for your entries; nothing changes until you approve it, and you can undo. Your books stay yours: it gives feedback, but won't write your story.</p>
          </div>
        )}
        {items.map((it, i) => [
          renderItem(it),
          // Where the earlier conversation ends and today's begins.
          earlier && i === earlier.count - 1 && (
            <div key="earlier" className="assistant-earlier">
              Last talked {earlier.at}
            </div>
          ),
        ])}
        {state === "waking" && <div className="msg activity">Waking the assistant… (the first time can take a little while)</div>}
        {error && <div className="msg error">{error}</div>}
      </div>

      <footer className="assistant-input">
        <div className="assistant-box">
          <textarea
            value={input}
            rows={2}
            placeholder={`Ask about ${subjectLabel}…`}
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
            <button className="icon-btn send" onClick={send} disabled={!input.trim() || state === "loading"} title="Send (Enter)">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}
