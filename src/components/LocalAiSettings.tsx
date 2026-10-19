import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { gb, localAi, recommend, useLocalAi, type AiDevice, type LocalAiStatus } from "../lib/localAi";
import { useStore } from "../store";

interface Progress {
  label: string;
  done: number;
  total: number;
}

/** Turn on, download and manage the built-in assistant. */
export function LocalAiSettings() {
  const { enabled, model, thinking, setPrefs } = useLocalAi();
  const notify = useStore((s) => s.notify);
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [devices, setDevices] = useState<AiDevice[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const s = await localAi.status();
    setStatus(s);
    if (s.engineInstalled && !devices) localAi.hardware().then(setDevices, () => setDevices([]));
  };
  useEffect(() => {
    reload();
    const offProgress = listen<Progress>("local-ai://progress", (e) => setProgress(e.payload));
    const offDone = listen<{ ok: boolean; error?: string }>("local-ai://installed", (e) => {
      setProgress(null);
      if (!e.payload.ok) setError(e.payload.error ?? "The download failed.");
      else notify("The assistant is ready. Open it from the sidebar.");
      reload();
    });
    return () => {
      offProgress.then((f) => f());
      offDone.then((f) => f());
    };
  }, []);

  // The engine runs on the first device (a dedicated card when there is one).
  const vram = devices?.[0]?.memoryMb ?? 0;
  const suggested = status && devices ? recommend(status.models, vram) : "standard";
  const current = status?.models.find((m) => m.id === model);

  const download = async (id: string) => {
    setError(null);
    setPrefs({ model: id as typeof model });
    try {
      await localAi.install(id);
      setStatus((s) => (s ? { ...s, downloading: true } : s));
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section>
      <h2>Built-in assistant</h2>
      <p className="hint">
        An AI that runs entirely on this computer: no account, no cost and nothing sent anywhere. It helps you build your
        world, writing and expanding lore entries with you, and reviews your chapters. Your books stay yours: it gives
        feedback on your story but won't write it. It's a smaller model than the big online AIs, so check what it writes.
      </p>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setPrefs({ enabled: e.target.checked })} />
        <span>
          Turn on the built-in assistant
          <small>Off by default. Nothing is downloaded or run until you turn it on.</small>
        </span>
      </label>

      {enabled && status && (
        <div className="local-ai">
          {devices && devices.length > 0 && (
            <p className="hint">
              Runs on: {devices[0].name} ({(devices[0].memoryMb / 1024).toFixed(0)} GB
              {devices[0].dedicated ? "" : ", shared with the computer's memory"})
            </p>
          )}
          {devices && devices.length === 0 && status.engineInstalled && (
            <p className="hint">No graphics card found for AI, so it will run on the processor: expect slow replies. Small is best here.</p>
          )}
          <div className="model-list">
            {status.models.map((m) => {
              const tooBig = devices !== null && devices.length > 0 && m.vramMb > vram + 500;
              return (
                <div key={m.id} className={`model ${model === m.id ? "on" : ""}`}>
                  <button className="model-pick" onClick={() => m.installed && setPrefs({ model: m.id })} disabled={!m.installed}>
                    <strong>
                      {m.label}
                      {m.id === suggested && <span className="badge">Recommended</span>}
                    </strong>
                    <small>
                      {gb(m.bytes)} download{tooBig ? " · may be slow on this computer" : ""}
                      {m.installed ? " · downloaded" : ""}
                    </small>
                  </button>
                  {m.installed ? (
                    <button className="link quiet" onClick={async () => (await localAi.remove(m.id, false), reload())}>
                      Remove
                    </button>
                  ) : (
                    <button className="ghost tiny" disabled={status.downloading || !!progress} onClick={() => download(m.id)}>
                      Download
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!status.engineInstalled && !progress && (
            <p className="hint">The first download also fetches the AI engine ({gb(status.engineBytes)}).</p>
          )}
          {progress && (
            <div className="download">
              <span>
                Downloading {progress.label}… {gb(progress.done)} of {gb(progress.total)}
              </span>
              <div className="progress">
                <div style={{ width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
              <button className="link quiet" onClick={() => localAi.cancelDownload()}>
                Cancel
              </button>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          {current?.installed && (
            <label className="check">
              <input type="checkbox" checked={thinking} onChange={(e) => setPrefs({ thinking: e.target.checked })} />
              <span>
                Think before answering
                <small>Slower, but sometimes more careful with tricky questions.</small>
              </span>
            </label>
          )}
          <div className="row">
            <span className="hint">Using {gb(status.diskUsed)} of disk space.</span>
            <span className="spacer" />
            {status.diskUsed > 0 && (
              <button
                className="link quiet"
                onClick={async () => {
                  await localAi.remove(null, true);
                  setDevices(null);
                  reload();
                }}
              >
                Remove all downloaded AI files
              </button>
            )}
          </div>
          <p className="hint">
            The assistant starts when you use it, stops after 10 minutes unused, and always closes with Eardloom.
          </p>
        </div>
      )}
    </section>
  );
}
