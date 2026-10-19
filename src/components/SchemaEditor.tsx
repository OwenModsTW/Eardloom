import { useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api, newId } from "../lib/api";
import { useStore } from "../store";
import { TYPE_ICONS, TypeIcon } from "../lib/icons";
import { useAutosave } from "../lib/useAutosave";
import { Select } from "./Select";
import type { EntryType, FamilyRole, FieldDef, FieldKind } from "../lib/types";
import { FAMILY_ROLES } from "../lib/relations";

const KINDS: { kind: FieldKind; label: string }[] = [
  { kind: "text", label: "Short text" },
  { kind: "longtext", label: "Paragraph" },
  { kind: "number", label: "Number" },
  { kind: "worlddate", label: "Date on the timeline" },
  { kind: "date", label: "Date (free text)" },
  { kind: "select", label: "Choice (one)" },
  { kind: "multiselect", label: "Choice (many)" },
  { kind: "boolean", label: "Yes / No" },
  { kind: "list", label: "List of words" },
  { kind: "entry", label: "Link to one entry" },
  { kind: "entries", label: "Link to many entries" },
  { kind: "url", label: "Web link" },
];

const COLORS = ["#e0a458", "#6fb58a", "#c96d6d", "#9b8bd4", "#5fb0c9", "#d4b45f", "#e6c86e", "#b07fc9", "#9bb46f", "#7fa7d9", "#d98fb0", "#8b9bb4"];

const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

export function SchemaEditor({ typeId }: { typeId?: string }) {
  const { types, entries, go, refreshTypes, notify } = useStore();
  const selected = types.find((t) => t.id === typeId) ?? types[0];

  const addType = async () => {
    const t: EntryType = { id: newId(), name: "New Category", plural: "New Category", icon: "FileText", color: COLORS[types.length % COLORS.length], sort: types.length, fields: [] };
    await api.saveType(t);
    await refreshTypes();
    go({ view: "schema", typeId: t.id });
  };

  const reorder = async (i: number, by: number) => {
    const next = move(types, i, by);
    await Promise.all(next.map((t, sort) => (t.sort === sort ? null : api.saveType({ ...t, sort }))));
    await refreshTypes();
  };

  const removeType = async (t: EntryType) => {
    if (!(await ask(`Delete the "${t.name}" category?`, { title: "Delete category", kind: "warning" }))) return;
    try {
      await api.deleteType(t.id);
      await refreshTypes();
      go({ view: "schema" });
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <div className="page schema">
      <header className="page-head">
        <div>
          <h1>World Structure</h1>
          <p className="hint">
            Decide what kinds of things exist in this world and what you want to track about each one. Every world can be
            different, so a zombie apocalypse never needs a starship field.
          </p>
        </div>
      </header>
      <div className="schema-columns">
        <nav className="schema-types">
          {types.map((t, i) => (
            <div key={t.id} className={`schema-type ${t.id === selected?.id ? "active" : ""}`}>
              <button className="schema-type-name" onClick={() => go({ view: "schema", typeId: t.id })}>
                <TypeIcon name={t.icon} size={15} color={t.color} />
                <span>{t.plural}</span>
                <small>{entries.filter((e) => e.typeId === t.id).length}</small>
              </button>
              <button className="icon-btn" onClick={() => reorder(i, -1)} aria-label="Move up">
                <ArrowUp size={13} />
              </button>
              <button className="icon-btn" onClick={() => reorder(i, 1)} aria-label="Move down">
                <ArrowDown size={13} />
              </button>
            </div>
          ))}
          <button className="ghost" onClick={addType}>
            <Plus size={14} /> Add category
          </button>
        </nav>
        {selected ? (
          <TypeForm key={selected.id} initial={selected} onDelete={() => removeType(selected)} />
        ) : (
          <p className="page-note">Add a category to get started.</p>
        )}
      </div>
    </div>
  );
}

function TypeForm({ initial, onDelete }: { initial: EntryType; onDelete: () => void }) {
  const [t, setT] = useState(initial);
  const types = useStore((s) => s.types);
  const refreshTypes = useStore((s) => s.refreshTypes);
  const { schedule } = useAutosave(async (value: EntryType) => {
    await api.saveType(value);
    await refreshTypes();
  }, 400);

  const update = (patch: Partial<EntryType>) =>
    setT((prev) => {
      const next = { ...prev, ...patch };
      schedule(next);
      return next;
    });
  const setField = (i: number, patch: Partial<FieldDef>) =>
    update({ fields: t.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  const addField = () => update({ fields: [...t.fields, { id: newId(), label: "New field", kind: "text" }] });

  return (
    <div className="type-form">
      <div className="type-form-head">
        <label className="field">
          <span>Name (one)</span>
          <input value={t.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Name (many)</span>
          <input value={t.plural} onChange={(e) => update({ plural: e.target.value })} />
        </label>
      </div>

      <label className="field">
        <span>Colour</span>
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${t.color === c ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => update({ color: c })}
              aria-label={c}
            />
          ))}
          <input type="color" value={t.color} onChange={(e) => update({ color: e.target.value })} />
        </div>
      </label>

      <label className="field">
        <span>Icon</span>
        <div className="icon-grid">
          {Object.keys(TYPE_ICONS).map((name) => (
            <button
              key={name}
              className={t.icon === name ? "on" : ""}
              style={{ color: t.icon === name ? t.color : undefined }}
              onClick={() => update({ icon: name })}
              title={name}
            >
              <TypeIcon name={name} size={16} />
            </button>
          ))}
        </div>
      </label>

      <h3>Fields</h3>
      <p className="hint">
        Every entry already has a name, aliases, tags, image, summary and an article. Add whatever else matters for{" "}
        {t.plural.toLowerCase()}.
      </p>
      <div className="field-rows">
        {t.fields.map((f, i) => (
          <div key={f.id} className="field-row">
            <div className="field-row-main">
              <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Field name" />
              <Select value={f.kind} onChange={(kind) => setField(i, { kind })} options={KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
              <input
                className="section-input"
                value={f.section ?? ""}
                onChange={(e) => setField(i, { section: e.target.value || undefined })}
                placeholder="Section (optional)"
              />
              <button className="icon-btn" onClick={() => update({ fields: move(t.fields, i, -1) })} aria-label="Move up">
                <ArrowUp size={13} />
              </button>
              <button className="icon-btn" onClick={() => update({ fields: move(t.fields, i, 1) })} aria-label="Move down">
                <ArrowDown size={13} />
              </button>
              <button className="icon-btn danger" onClick={() => update({ fields: t.fields.filter((_, j) => j !== i) })} aria-label="Remove field">
                <Trash2 size={13} />
              </button>
            </div>
            {(f.kind === "select" || f.kind === "multiselect") && (
              <input
                className="field-row-extra"
                placeholder="Choices, separated by commas"
                defaultValue={f.options?.join(", ") ?? ""}
                onBlur={(e) => setField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            {(f.kind === "entry" || f.kind === "entries") && (
              <div className="field-row-extra target-types">
                <span>Can link to:</span>
                {types.map((tt) => {
                  const on = f.targetTypes?.includes(tt.id) ?? false;
                  return (
                    <button
                      key={tt.id}
                      className={on ? "on" : ""}
                      onClick={() =>
                        setField(i, { targetTypes: on ? f.targetTypes!.filter((x) => x !== tt.id) : [...(f.targetTypes ?? []), tt.id] })
                      }
                    >
                      {tt.plural}
                    </button>
                  );
                })}
                {!f.targetTypes?.length && <small>(anything)</small>}
              </div>
            )}
            {(f.kind === "entry" || f.kind === "entries") && (
              <div className="field-row-extra relation-row">
                <label>
                  <span>On the linked entry, show as</span>
                  <input
                    value={f.inverse ?? ""}
                    placeholder={`e.g. ${f.family ? (FAMILY_ROLES.find((r) => r.value === f.family)?.inverse ?? "") : "Members, Home of, Children"}`}
                    onChange={(e) => setField(i, { inverse: e.target.value || undefined })}
                  />
                </label>
                <label>
                  <span>Family tree</span>
                  <Select
                    value={f.family ?? ""}
                    onChange={(v) => {
                      const family = (v || undefined) as FamilyRole | undefined;
                      const role = FAMILY_ROLES.find((r) => r.value === family);
                      setField(i, { family, ...(role && !f.inverse ? { inverse: role.inverse } : {}) });
                    }}
                    options={[{ value: "", label: "Not part of it" }, ...FAMILY_ROLES.map((r) => ({ value: r.value, label: `Links ${r.label.toLowerCase()}` }))]}
                  />
                </label>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row">
        <button className="ghost" onClick={addField}>
          <Plus size={14} /> Add field
        </button>
        <span className="spacer" />
        <button className="danger subtle" onClick={onDelete}>
          <Trash2 size={14} /> Delete category
        </button>
      </div>
    </div>
  );
}
