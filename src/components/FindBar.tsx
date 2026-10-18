import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { searchState } from "../lib/editor/search";

/** Find (Ctrl+F) and replace (Ctrl+H) within the open document. */
export function FindBar({
  editor,
  initial,
  withReplace,
  onClose,
}: {
  editor: Editor;
  initial: string;
  withReplace: boolean;
  onClose: () => void;
}) {
  const [term, setTerm] = useState(initial);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWhole] = useState(false);
  const [showReplace, setShowReplace] = useState(withReplace);
  const findRef = useRef<HTMLInputElement>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const st = searchState(e.state);
      return { count: st?.matches.length ?? 0, current: st?.current ?? -1 };
    },
  });

  useEffect(() => {
    findRef.current?.select();
  }, []);
  useEffect(() => setShowReplace((r) => r || withReplace), [withReplace]);
  useEffect(() => {
    editor.commands.setSearch(term, { caseSensitive, wholeWord });
  }, [term, caseSensitive, wholeWord, editor]);
  useEffect(() => () => void editor.commands.clearSearch(), [editor]);

  const close = () => {
    editor.commands.clearSearch();
    onClose();
    editor.commands.focus();
  };

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key === "Enter" && e.currentTarget === findRef.current) {
      e.preventDefault();
      e.shiftKey ? editor.commands.findPrevious() : editor.commands.findNext();
    }
  };

  return (
    <div className="find-bar" role="search" onKeyDown={keys}>
      <div className="find-row">
        <input ref={findRef} value={term} placeholder="Find" onChange={(e) => setTerm(e.target.value)} />
        <span className="find-count">{term ? (s.count ? `${s.current + 1} of ${s.count}` : "No results") : ""}</span>
        <button className={`find-opt ${caseSensitive ? "on" : ""}`} title="Match case" onClick={() => setCase(!caseSensitive)}>
          Aa
        </button>
        <button className={`find-opt ${wholeWord ? "on" : ""}`} title="Whole words only" onClick={() => setWhole(!wholeWord)}>
          <u>ab</u>
        </button>
        <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => editor.commands.findPrevious()} disabled={!s.count}>
          <ChevronUp size={15} />
        </button>
        <button className="icon-btn" title="Next (Enter)" onClick={() => editor.commands.findNext()} disabled={!s.count}>
          <ChevronDown size={15} />
        </button>
        <button className="find-toggle link quiet" onClick={() => setShowReplace(!showReplace)}>
          {showReplace ? "Hide replace" : "Replace…"}
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {showReplace && (
        <div className="find-row">
          <input
            value={replacement}
            placeholder="Replace with"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), editor.commands.replaceCurrent(replacement))}
          />
          <button className="ghost tiny" disabled={!s.count} onClick={() => editor.commands.replaceCurrent(replacement)}>
            Replace
          </button>
          <button className="ghost tiny" disabled={!s.count} onClick={() => editor.commands.replaceAll(replacement)}>
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
