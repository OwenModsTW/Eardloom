import { useEffect, useState } from "react";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { useStore } from "../store";
import { backupDir, backupNow, formatSize, getBackupPrefs, listBackups, setBackupPrefs, type BackupInfo } from "../lib/backup";
import { Select } from "./Select";

const LIMITS = [100, 250, 500, 1000, 2000];

export function BackupSettings() {
  const { notify, openWorld } = useStore();
  const [prefs, setPrefs] = useState(getBackupPrefs);
  const [dir, setDir] = useState("");
  const [list, setList] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setDir(await backupDir());
    setList(await listBackups());
  };
  useEffect(() => {
    reload();
  }, [prefs.dir]);

  const update = (patch: Parameters<typeof setBackupPrefs>[0]) => setPrefs(setBackupPrefs(patch));
  const total = list.reduce((n, b) => n + b.size, 0);

  const now = async () => {
    setBusy(true);
    try {
      const r = await backupNow(true);
      notify(r.created ? "Backup saved" : "Already backed up");
      await reload();
    } catch (e) {
      notify(`Backup failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (b: BackupInfo) => {
    const when = new Date(b.created * 1000).toLocaleString();
    if (!(await ask(`Open the backup from ${when}? It opens as a separate copy. Your current world is not changed.`, { title: "Restore backup" })))
      return;
    try {
      await openWorld(await api.importWorldPack(b.path, await api.defaultWorldsDir()));
      notify("Backup opened as a copy");
    } catch (e) {
      notify(`Couldn't open the backup: ${String(e)}`);
    }
  };

  return (
    <section>
      <h2>Backups</h2>
      <label className="check">
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <span>
          Back up automatically
          <small>When you open a world, every few hours while it's open, and when you close it. Nothing is saved if nothing changed.</small>
        </span>
      </label>
      <div className="setting">
        <span>Folder</span>
        <div className="row">
          <code className="grow">{dir}</code>
          <button
            className="ghost"
            onClick={async () => {
              const d = await openDialog({ directory: true, defaultPath: dir });
              if (typeof d === "string") update({ dir: d });
            }}
          >
            Change…
          </button>
        </div>
      </div>
      <div className="setting">
        <span>Space per world</span>
        <Select
          value={String(prefs.maxMb)}
          onChange={(v) => update({ maxMb: Number(v) })}
          options={LIMITS.map((mb) => ({ value: String(mb), label: mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB` }))}
        />
      </div>
      <p className="hint">
        Eardloom keeps the latest backup, one a day for a week, one a week for a month and one a month for six months, and
        removes the oldest if this world's backups would go over the limit.
      </p>

      <div className="row backup-head">
        <strong>This world</strong>
        <span className="hint">
          {list.length} backup{list.length === 1 ? "" : "s"} · {formatSize(total)}
        </span>
        <span className="spacer" />
        {list[0] && (
          <button className="link quiet" onClick={() => revealItemInDir(list[0].path)}>
            Show folder
          </button>
        )}
        <button className="ghost" disabled={busy} onClick={now}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
      </div>
      {list.length > 0 && (
        <ul className="backup-list">
          {list.map((b) => (
            <li key={b.file}>
              <span>{new Date(b.created * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
              <small>{formatSize(b.size)}</small>
              <button className="link quiet" onClick={() => restore(b)}>
                Restore…
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
