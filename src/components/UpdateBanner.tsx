import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, X } from "lucide-react";
import { useUpdater } from "../lib/updater";
import { Markdown } from "./Markdown";

/** Slim reminder at the top of the window after choosing "Later". */
export function UpdateBanner() {
  const { status, promptOpen, bannerDismissed, install, dismissBanner } = useUpdater();
  if (promptOpen || bannerDismissed || status.state !== "available") return null;
  return (
    <div className="update-banner">
      <Download size={15} />
      <span>Eardloom {status.update.version} is ready to install.</span>
      <button className="primary" onClick={install}>
        Update &amp; restart
      </button>
      <button className="icon-btn" onClick={dismissBanner} aria-label="Hide until next launch">
        <X size={14} />
      </button>
    </div>
  );
}

/** Shown as soon as an update is found, with its release notes. */
export function UpdatePrompt() {
  const { status, promptOpen, install, later } = useUpdater();
  const [current, setCurrent] = useState("");
  useEffect(() => {
    getVersion().then(setCurrent);
  }, []);

  if (!promptOpen || (status.state !== "available" && status.state !== "downloading" && status.state !== "error")) return null;
  if (status.state === "error")
    return (
      <div className="overlay">
        <div className="dialog update-dialog" role="alertdialog">
          <header className="dialog-head">
            <h2>The update didn't install</h2>
          </header>
          <div className="update-notes">
            <p className="error-text">{status.message}</p>
            <p className="hint">Nothing has changed. You can carry on with this version and try again from Settings.</p>
          </div>
          <footer className="dialog-foot">
            <span className="spacer" />
            <button className="primary" onClick={later}>
              OK
            </button>
          </footer>
        </div>
      </div>
    );

  const { update } = status;
  const downloading = status.state === "downloading";
  const [summary, ...rest] = (update.body ?? "").trim().split(/\n\s*\n/);

  return (
    <div className="overlay">
      <div className="dialog update-dialog" role="alertdialog" aria-label="Update available">
        <header className="dialog-head">
          <span className="update-eyebrow">Update available</span>
          <h2>Eardloom {update.version}</h2>
          {current && <span className="hint">You have {current}</span>}
        </header>
        <div className="update-notes">
          {summary && <p className="update-summary">{summary}</p>}
          {rest.length > 0 && <Markdown text={rest.join("\n\n")} />}
        </div>
        <footer className="dialog-foot">
          {downloading ? (
            <>
              <span className="hint">Downloading… {status.percent}%</span>
              <div className="progress">
                <div style={{ width: `${status.percent}%` }} />
              </div>
              <span className="spacer" />
              <span className="hint">Eardloom will restart by itself.</span>
            </>
          ) : (
            <>
              <span className="hint">Your worlds aren't touched by updates.</span>
              <span className="spacer" />
              <button className="ghost" onClick={later}>
                Later
              </button>
              <button className="primary" onClick={install} autoFocus>
                Update &amp; restart
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
