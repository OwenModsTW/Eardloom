import { useEffect, useState } from "react";
import { create } from "zustand";

interface Request {
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirm?: string;
  /** Suggestions shown under the box (e.g. existing tags). */
  suggestions?: string[];
  /** An empty answer is allowed (and resolves to ""). */
  allowEmpty?: boolean;
  resolve: (value: string | null) => void;
}

const usePrompt = create<{ request: Request | null }>(() => ({ request: null }));

/** Asks for a short piece of text. Resolves to the trimmed text, or null if cancelled. */
export function askText(options: Omit<Request, "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    usePrompt.getState().request?.resolve(null);
    usePrompt.setState({ request: { ...options, resolve } });
  });
}

export function PromptHost() {
  const request = usePrompt((s) => s.request);
  const [value, setValue] = useState("");
  useEffect(() => setValue(request?.initial ?? ""), [request]);
  if (!request) return null;

  const done = (v: string | null) => {
    usePrompt.setState({ request: null });
    request.resolve(v === null ? null : v.trim() || (request.allowEmpty ? "" : null));
  };
  const q = value.trim().toLowerCase();
  const suggestions = (request.suggestions ?? []).filter((s) => !q || s.toLowerCase().includes(q)).slice(0, 8);

  return (
    <div className="overlay" onMouseDown={() => done(null)}>
      <form
        className="dialog prompt"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => (e.preventDefault(), done(value))}
        role="dialog"
        aria-label={request.title}
      >
        <header className="dialog-head">
          <h2>{request.title}</h2>
        </header>
        <div className="prompt-body">
          {request.label && <label htmlFor="prompt-input">{request.label}</label>}
          <input
            id="prompt-input"
            autoFocus
            value={value}
            placeholder={request.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), done(null))}
          />
          {suggestions.length > 0 && (
            <div className="prompt-suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="tag" onClick={() => done(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="dialog-foot">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!value.trim() && !request.allowEmpty}>
            {request.confirm ?? "OK"}
          </button>
        </footer>
      </form>
    </div>
  );
}
