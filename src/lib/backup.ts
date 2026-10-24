import type { BackupOutcome } from "./bindings";
import { invoke } from "@tauri-apps/api/core";

export interface BackupPrefs {
  enabled: boolean;
  /** Empty means the default (Documents\Eardloom Backups). */
  dir: string;
  /** Storage limit per world, in MB. */
  maxMb: number;
}

export interface BackupInfo {
  file: string;
  path: string;
  created: number;
  size: number;
}

const KEY = "eardloom.backups";
const DEFAULTS: BackupPrefs = { enabled: true, dir: "", maxMb: 500 };
const EVERY = 4 * 60 * 60 * 1000;

export function getBackupPrefs(): BackupPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function setBackupPrefs(patch: Partial<BackupPrefs>) {
  const next = { ...getBackupPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* preference just won't persist */
  }
  return next;
}

export async function backupDir() {
  return getBackupPrefs().dir || (await invoke<string>("default_backup_dir"));
}

export async function backupNow(force = false) {
  const prefs = getBackupPrefs();
  return invoke<BackupOutcome>("run_backup", {
    dir: await backupDir(),
    maxMb: prefs.maxMb,
    force,
  });
}

export async function listBackups() {
  return invoke<BackupInfo[]>("list_backups", { dir: await backupDir() });
}

/** Back up shortly after a world opens, then every few hours. Returns a stop function. */
export function startAutoBackups() {
  const run = () => getBackupPrefs().enabled && backupNow().catch((e) => console.error("Backup failed", e));
  const first = window.setTimeout(run, 30_000);
  const timer = window.setInterval(run, EVERY);
  return () => {
    window.clearTimeout(first);
    window.clearInterval(timer);
  };
}

/** One last backup before closing a world (skipped if nothing changed). */
export async function backupOnClose() {
  if (getBackupPrefs().enabled) await backupNow().catch(() => {});
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
