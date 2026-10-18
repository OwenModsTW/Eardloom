import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { TEMPLATES, instantiateTemplate } from "../lib/templates";
import { TypeIcon } from "../lib/icons";
import type { RecentWorld } from "../lib/types";

export function Home() {
  const [recent, setRecent] = useState<RecentWorld[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openWorld = useStore((s) => s.openWorld);

  useEffect(() => {
    api.listRecentWorlds().then((r) => (setRecent(r), r.length === 0 && setCreating(true)));
  }, []);

  const openPath = async (path: string) => {
    try {
      await openWorld(await api.openWorld(path));
    } catch (e) {
      setError(String(e));
    }
  };

  const browse = async () => {
    const dir = await openDialog({ directory: true, title: "Open a world folder" });
    if (typeof dir === "string") openPath(dir);
  };

  return (
    <div className="home">
      <div className="home-brand">
        <img src="/logo.png" alt="" width={72} height={72} />
        <h1>Eardloom</h1>
        <p>Build worlds. Write in them. Share them.</p>
      </div>
      {error && (
        <div className="error-box" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {creating ? (
        <NewWorld onCancel={recent.length ? () => setCreating(false) : undefined} onError={setError} />
      ) : (
        <div className="home-panel">
          <div className="row">
            <h2>Your worlds</h2>
            <span className="spacer" />
            <button className="ghost" onClick={browse}>
              <FolderOpen size={15} /> Open folder…
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New world
            </button>
          </div>
          <ul className="world-list">
            {recent.map((w) => (
              <li key={w.path}>
                <button className="world-item" onClick={() => openPath(w.path)}>
                  <strong>{w.name}</strong>
                  <small>{w.path}</small>
                </button>
                <button
                  className="icon-btn hover-only"
                  title="Remove from list (doesn't delete files)"
                  onClick={async () => (await api.forgetRecentWorld(w.path), setRecent(recent.filter((x) => x.path !== w.path)))}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewWorld({ onCancel, onError }: { onCancel?: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("fantasy");
  const [parentDir, setParentDir] = useState("");
  const [busy, setBusy] = useState(false);
  const openWorld = useStore((s) => s.openWorld);

  useEffect(() => {
    api.defaultWorldsDir().then(setParentDir);
  }, []);

  const template = TEMPLATES.find((t) => t.id === templateId)!;

  const create = async () => {
    setBusy(true);
    try {
      const world = await api.createWorld({
        parentDir,
        name: name.trim() || "Untitled World",
        description,
        genre: templateId,
        types: instantiateTemplate(template),
      });
      await openWorld(world);
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="home-panel new-world">
      <h2>Create a world</h2>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="Name your world" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Premise (optional)</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <span className="field-label">Starting template</span>
      <div className="template-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={`template ${t.id === templateId ? "on" : ""}`} onClick={() => setTemplateId(t.id)}>
            <strong>{t.name}</strong>
            <small>{t.blurb}</small>
          </button>
        ))}
      </div>
      <div className="template-preview">
        {template.types.map((t) => (
          <span key={t.name} style={{ color: t.color }}>
            <TypeIcon name={t.icon} size={13} /> {t.plural}
          </span>
        ))}
        <small>You can add, rename or remove any of these later.</small>
      </div>

      <label className="field">
        <span>Saved in</span>
        <div className="row">
          <input value={parentDir} onChange={(e) => setParentDir(e.target.value)} />
          <button
            className="ghost"
            onClick={async () => {
              const dir = await openDialog({ directory: true, defaultPath: parentDir });
              if (typeof dir === "string") setParentDir(dir);
            }}
          >
            Browse…
          </button>
        </div>
      </label>

      <div className="row">
        {onCancel && (
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        <button className="primary" disabled={busy || !parentDir} onClick={create}>
          {busy ? "Creating…" : "Create world"}
        </button>
      </div>
    </div>
  );
}
