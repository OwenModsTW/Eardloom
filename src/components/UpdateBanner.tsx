import { Download, X } from "lucide-react";
import { useUpdater } from "../lib/updater";

export function UpdateBanner() {
  const { status, dismissed, install, dismiss } = useUpdater();
  if (dismissed) return null;
  if (status.state === "available")
    return (
      <div className="update-banner">
        <Download size={15} />
        <span>
          Eardloom {status.update.version} is available.
          {status.update.body && <em> {status.update.body.split("\n")[0]}</em>}
        </span>
        <button className="primary" onClick={install}>
          Update &amp; restart
        </button>
        <button className="icon-btn" onClick={dismiss} aria-label="Later">
          <X size={14} />
        </button>
      </div>
    );
  if (status.state === "downloading")
    return (
      <div className="update-banner">
        <Download size={15} />
        <span>Downloading update… {status.percent}%</span>
        <div className="progress">
          <div style={{ width: `${status.percent}%` }} />
        </div>
      </div>
    );
  return null;
}
