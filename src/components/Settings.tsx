import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, RefreshCw } from "lucide-react";
import { useStore } from "../store";
import { useUpdater } from "../lib/updater";
import { ACCENTS, getAppearance, setAppearance, type AccentPreset } from "../lib/theme";
import { Select } from "./Select";
import { showWhatsNew } from "./WhatsNew";
import { getDefaultAuthor, setDefaultAuthor } from "../lib/prefs";

export function Settings() {
  const world = useStore((s) => s.world)!;
  const { status, checkNow, install } = useUpdater();
  const [version, setVersion] = useState("");
  const [look, setLook] = useState(getAppearance);
  const [author, setAuthor] = useState(getDefaultAuthor);
  const mode = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const isCustom = !(look.accent in ACCENTS);
  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  return (
    <div className="page settings">
      <h1>Settings</h1>

      <section>
        <h2>Appearance</h2>
        <div className="setting">
          <span>Theme</span>
          <Select
            value={look.theme}
            onChange={(theme) => setLook(setAppearance({ theme }))}
            options={[
              { value: "dark", label: "Lamplit", hint: "Dark teal (default)" },
              { value: "light", label: "Daylight", hint: "Parchment and sage" },
              { value: "system", label: "Match Windows" },
            ]}
          />
        </div>
        <div className="setting">
          <span>Accent</span>
          <div className="accents">
            {(Object.keys(ACCENTS) as AccentPreset[]).map((key) => (
              <button
                key={key}
                className={`accent-swatch ${look.accent === key ? "on" : ""}`}
                style={{ background: ACCENTS[key][mode] }}
                title={ACCENTS[key].label}
                onClick={() => setLook(setAppearance({ accent: key }))}
              />
            ))}
            <label className={`accent-custom ${isCustom ? "on" : ""}`} title="Custom colour">
              <input
                type="color"
                value={isCustom ? look.accent : "#f6bd60"}
                onChange={(e) => setLook(setAppearance({ accent: e.target.value }))}
              />
              Custom
            </label>
          </div>
        </div>
      </section>

      <section>
        <h2>Writing</h2>
        <div className="setting">
          <span>Author name</span>
          <input
            value={author}
            placeholder="Your name or pen name"
            onChange={(e) => (setAuthor(e.target.value), setDefaultAuthor(e.target.value))}
          />
        </div>
        <p className="hint">Used on exported books. Each book can override it in its export settings.</p>
      </section>

      <section>
        <h2>This world</h2>
        <p className="hint">
          Everything for this world lives in one folder: the database and an assets folder for images. Copy the folder to back
          it up or move it to another computer.
        </p>
        <div className="row">
          <code>{world.path}</code>
          <button className="ghost" onClick={() => revealItemInDir(`${world.path}/world.db`)}>
            <FolderOpen size={14} /> Show in Explorer
          </button>
        </div>
      </section>

      <section>
        <h2>Updates</h2>
        <p>Eardloom {version}</p>
        <div className="row">
          <button className="ghost" onClick={() => showWhatsNew()}>
            What's new
          </button>
          <button className="ghost" disabled={status.state === "checking"} onClick={() => checkNow()}>
            <RefreshCw size={14} /> Check for updates
          </button>
          {status.state === "checking" && <span className="hint">Checking…</span>}
          {status.state === "current" && <span className="hint">You're on the latest version.</span>}
          {status.state === "available" && (
            <button className="primary" onClick={install}>
              Install {status.update.version} &amp; restart
            </button>
          )}
          {status.state === "downloading" && <span className="hint">Downloading… {status.percent}%</span>}
          {status.state === "error" && <span className="error-text">Couldn't check: {status.message}</span>}
        </div>
      </section>
    </div>
  );
}
