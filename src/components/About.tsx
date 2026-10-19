import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Search, X } from "lucide-react";

interface Pkg {
  name: string;
  version: string;
  kind: "npm" | "crate" | "download";
  licence: string;
  source: string;
  texts: string[];
}

interface LicenceData {
  packages: Pkg[];
  downloaded: Pkg[];
  texts: Record<string, string>;
}

function LicencesDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<LicenceData | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    // Loaded only when opened: it's a large list.
    import("../generated/licenses.json").then((m) => setData(m.default as LicenceData));
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = data ? [...data.downloaded, ...data.packages] : [];
    return q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.licence.toLowerCase().includes(q)) : all;
  }, [data, query]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog licences" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Open-source licences">
        <header className="dialog-head row">
          <h2>Open-source licences</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>
        <div className="licences-body">
          <p className="hint">
            Eardloom is built with these open-source projects, used under the licences below. Items marked “downloaded on
            request” are only fetched if you turn on the built-in assistant.
          </p>
          <label className="search-inline">
            <Search size={13} />
            <input placeholder="Find a package or licence" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {!data && <p className="hint">Loading…</p>}
          <ul className="licence-list">
            {list.map((p) => {
              const id = `${p.kind}:${p.name}@${p.version}`;
              return (
                <li key={id}>
                  <button className="licence-row" onClick={() => setOpen(open === id ? null : id)}>
                    <strong>{p.name}</strong>
                    <small>
                      {p.version} · {p.licence}
                      {p.kind === "download" ? " · downloaded on request" : ""}
                    </small>
                  </button>
                  {open === id && data && (
                    <div className="licence-text">
                      <p className="hint">
                        Source: <span className="mono">{p.source}</span>
                      </p>
                      {p.texts.map((t) => (
                        <pre key={t}>{data.texts[t]}</pre>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Version, privacy and the licences of everything Eardloom is built with. */
export function About() {
  const [version, setVersion] = useState("");
  const [licences, setLicences] = useState(false);
  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <section>
      <h2>About</h2>
      <p>
        Eardloom {version} · © {new Date().getFullYear()} OwenModsTW. All rights reserved.
      </p>
      <h3 className="about-sub">Privacy</h3>
      <ul className="privacy">
        <li>Your worlds and writing are stored only on this computer, in the folders you choose. Eardloom doesn't collect or send them anywhere.</li>
        <li>Eardloom checks GitHub for updates. That's an ordinary download request; nothing from your worlds is included.</li>
        <li>
          The built-in assistant runs entirely on this computer. If you turn it on, its engine and model are downloaded once from
          GitHub and Hugging Face (who see a normal download request, like any website). After that it works offline, and your
          conversations never leave the computer.
        </li>
        <li>If you connect another AI app (Claude, Codex), that app's own terms and privacy policy apply to what you share with it.</li>
      </ul>
      <button className="ghost" onClick={() => setLicences(true)}>
        Open-source licences
      </button>
      {licences && <LicencesDialog onClose={() => setLicences(false)} />}
    </section>
  );
}
