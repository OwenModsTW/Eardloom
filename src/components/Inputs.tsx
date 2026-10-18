import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { JSONContent } from "@tiptap/react";
import { useStore } from "../store";
import { createEntry } from "../lib/actions";
import { RichEditor } from "./RichEditor";
import { Select } from "./Select";
import { DateInput } from "./DateInput";
import { EntryGlyph } from "./EntryIcon";
import type { FieldDef, FieldValue } from "../lib/types";

/** A list of short strings edited as removable chips. Enter or comma adds one. */
export function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="chips">
      {values.map((v) => (
        <span key={v} className="chip">
          {v}
          <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={values.length ? "" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

/** Picks one or more entries, optionally limited to certain entry types, and can create missing ones. */
export function EntryPicker({
  value,
  multiple,
  targetTypes,
  excludeId,
  onChange,
}: {
  value: string[];
  multiple: boolean;
  targetTypes?: string[];
  excludeId?: string;
  onChange: (ids: string[]) => void;
}) {
  const entries = useStore((s) => s.entries);
  const types = useStore((s) => s.types);
  const go = useStore((s) => s.go);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const allowed = useMemo(
    () => (targetTypes?.length ? types.filter((t) => targetTypes.includes(t.id)) : types),
    [types, targetTypes],
  );

  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    return entries
      .filter((e) => e.id !== excludeId && !value.includes(e.id))
      .filter((e) => allowed.some((t) => t.id === e.typeId))
      .filter((e) => !q || [e.title, ...e.aliases].some((n) => n.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [entries, query, value, allowed, excludeId]);

  const exact = matches.some((m) => m.title.toLowerCase() === query.trim().toLowerCase());
  const creates = query.trim() && !exact ? allowed.slice(0, 4) : [];
  const total = matches.length + creates.length;

  const pick = (id: string) => {
    onChange(multiple ? [...value, id] : [id]);
    setQuery("");
    setIndex(0);
    if (!multiple) setOpen(false);
  };
  const createAndPick = async (typeId: string) => {
    const created = await createEntry(typeId, query.trim(), false);
    pick(created.id);
  };
  const activate = (i: number) => (i < matches.length ? pick(matches[i].id) : createAndPick(creates[i - matches.length].id));

  const allowedNames = allowed.map((t) => t.plural.toLowerCase()).join(", ");

  return (
    <div className="picker">
      <div className="chips">
        {value.map((id) => {
          const e = entries.find((x) => x.id === id);
          const t = types.find((x) => x.id === e?.typeId);
          return (
            <span key={id} className="chip link" style={{ "--chip": t?.color } as React.CSSProperties}>
              <button className="chip-label" onClick={() => e && go({ view: "entry", id })}>
                {e?.emoji && <span className="chip-emoji">{e.emoji}</span>}
                {e?.title || (e ? "Untitled" : "missing")}
              </button>
              <button onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove link">
                <X size={11} />
              </button>
            </span>
          );
        })}
        {(multiple || value.length === 0) && (
          <input
            ref={inputRef}
            value={query}
            placeholder={value.length ? "" : "Link…"}
            onChange={(e) => (setQuery(e.target.value), setOpen(true), setIndex(0))}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(i + 1, total - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
              if (e.key === "Enter" && total) (e.preventDefault(), activate(index));
              if (e.key === "Escape") setOpen(false);
            }}
          />
        )}
      </div>
      {open && (
        <div className="menu picker-menu">
          {matches.map((o, i) => {
            const t = types.find((x) => x.id === o.typeId);
            return (
              <button key={o.id} className={i === index ? "active" : ""} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => (e.preventDefault(), pick(o.id))}>
                <span className="menu-icon">
                  <EntryGlyph entry={o} size={13} />
                </span>
                <span>{o.title || "Untitled"}</span>
                <small>{t?.name}</small>
              </button>
            );
          })}
          {creates.map((t, j) => (
            <button
              key={t.id}
              className={matches.length + j === index ? "active" : ""}
              onMouseEnter={() => setIndex(matches.length + j)}
              onMouseDown={(e) => (e.preventDefault(), createAndPick(t.id))}
            >
              <span className="menu-icon">
                <Plus size={13} />
              </span>
              <span>
                Create “{query.trim()}”
              </span>
              <small>new {t.name}</small>
            </button>
          ))}
          {total === 0 && (
            <p className="menu-note">
              {query.trim() ? "No matches." : `Nothing to link yet. This field takes ${allowedNames || "any entry"}.`}
              {!query.trim() && " Type a name to create one."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const asList = (v: FieldValue | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];

/** Older paragraph values were plain strings; upgrade them to a document on the fly. */
const asDoc = (v: FieldValue | undefined): JSONContent | null => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim())
    return { type: "doc", content: v.split("\n").map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })) };
  return null;
};

/** Renders the right control for any user-defined field kind. */
export function FieldInput({
  field,
  value,
  entryId,
  onChange,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  entryId: string;
  onChange: (value: FieldValue) => void;
}) {
  const v = value ?? null;
  switch (field.kind) {
    case "longtext":
      return (
        <RichEditor
          compact
          content={asDoc(v)}
          placeholder="Write… @ to link"
          onChange={(doc, _words, empty) => onChange(empty ? null : doc)}
        />
      );
    case "number":
      return (
        <input
          className="inline"
          inputMode="decimal"
          value={v === null || v === "" ? "" : String(v)}
          placeholder="—"
          onChange={(e) => {
            const raw = e.target.value.trim();
            const n = Number(raw);
            onChange(raw === "" ? null : Number.isFinite(n) ? n : raw);
          }}
        />
      );
    case "boolean":
      return (
        <button className={`switch ${v === true ? "on" : ""}`} role="switch" aria-checked={v === true} onClick={() => onChange(v !== true)}>
          <span />
          {v === true ? "Yes" : "No"}
        </button>
      );
    case "select":
      return (
        <Select
          className="inline"
          value={(v as string) || null}
          onChange={(x) => onChange(x === "" ? null : x)}
          options={[{ value: "", label: <span className="placeholder">None</span> }, ...(field.options ?? []).map((o) => ({ value: o, label: o }))]}
        />
      );
    case "multiselect": {
      const selected = asList(v);
      return (
        <div className="multiselect">
          {field.options?.map((o) => (
            <button
              key={o}
              className={selected.includes(o) ? "on" : ""}
              onClick={() => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])}
            >
              {o}
            </button>
          ))}
          {!field.options?.length && <span className="placeholder">No choices defined</span>}
        </div>
      );
    }
    case "list":
      return <ChipInput values={asList(v)} onChange={onChange} placeholder="Add…" />;
    case "entry":
    case "entries":
      return (
        <EntryPicker
          value={asList(v)}
          multiple={field.kind === "entries"}
          targetTypes={field.targetTypes}
          excludeId={entryId}
          onChange={(ids) => onChange(field.kind === "entries" ? ids : (ids[0] ?? null))}
        />
      );
    case "url":
      return <input className="inline" value={(v as string) ?? ""} placeholder="https://" onChange={(e) => onChange(e.target.value)} />;
    case "worlddate":
      return <DateInput value={v} onChange={onChange} />;
    case "date":
      // Free text on purpose: fictional calendars ("3rd Age, 1042") rarely fit a date picker.
      return <input className="inline" value={(v as string) ?? ""} placeholder="e.g. 1042, Third Age" onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className="inline" value={(v as string) ?? ""} placeholder="—" onChange={(e) => onChange(e.target.value)} />;
  }
}
